-- ============================================================================
-- SALESWORKS360 CRM: FIX TENANT ISOLATION - crm_org() & MEMBER CREATION
-- Migration: 20261029_fix_tenant_isolation_crm_org.sql
--
-- PROBLEM: When a company admin logs in, crm_org() returns the super-admin org
-- instead of their own company org, causing created members to land in the
-- wrong company and data to leak across tenants.
--
-- FIX:
--   1. Rewrite crm_org() with proper role-priority (no hardcoded org IDs).
--   2. Rewrite crm_company_admin_create_member to use p_org_id when supplied,
--      otherwise auto-detect the caller's Admin role org safely.
--   3. Rewrite crm_super_admin_create_company so new company admin users are
--      ONLY in their new company (clean zero-data slate).
--   4. Fix crm_leaderboard to remove hardcoded default org ID fallback.
-- ============================================================================

-- 1. REWRITE crm_org() - the central tenant resolver
CREATE OR REPLACE FUNCTION public.crm_org()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT organization_id
  FROM public.user_roles
  WHERE user_id = auth.uid()::text
  ORDER BY
    CASE role
      WHEN 'Super Admin'         THEN 1
      WHEN 'Organization Admin'  THEN 2
      WHEN 'Admin'               THEN 3
      WHEN 'Manager'             THEN 4
      WHEN 'Sales Manager'       THEN 5
      WHEN 'Team Leader'         THEN 6
      WHEN 'Executive'           THEN 7
      WHEN 'Sales Rep'           THEN 8
      WHEN 'Developer'           THEN 9
    END ASC
  LIMIT 1;

$$;

GRANT EXECUTE ON FUNCTION public.crm_org() TO authenticated, anon, service_role;

-- 2. REWRITE crm_company_admin_create_member (remove hardcoded super-admin org preference)
DROP FUNCTION IF EXISTS public.crm_company_admin_create_member(text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.crm_company_admin_create_member(
  p_email       text,
  p_name        text,
  p_password    text DEFAULT 'Member@12345',
  p_role        text DEFAULT 'Executive',
  p_team_id     text DEFAULT NULL,
  p_manager_id  text DEFAULT NULL,
  p_org_id      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_my_org        text;
  v_user_id       text;
  v_clean_email   text;
  v_clean_name    text;
  v_effective_pwd text;
BEGIN
  v_clean_email   := LOWER(TRIM(p_email));
  v_clean_name    := TRIM(p_name);
  v_effective_pwd := COALESCE(NULLIF(TRIM(p_password), ''), 'Member@12345');

  IF v_clean_email = '' OR v_clean_email IS NULL THEN
    RAISE EXCEPTION 'Member email address is required';
  END IF;

  IF v_clean_name = '' OR v_clean_name IS NULL THEN
    v_clean_name := split_part(v_clean_email, '@', 1);
  END IF;

  -- Determine target company
  IF p_org_id IS NOT NULL AND TRIM(p_org_id) != '' THEN
    v_my_org := TRIM(p_org_id);
  ELSE
    -- Auto-detect: caller's Admin/Organization Admin org (most recent first)
    SELECT organization_id INTO v_my_org
    FROM public.user_roles
    WHERE user_id = auth.uid()::text
      AND role IN ('Admin', 'Organization Admin')
    ORDER BY
      CASE role
        WHEN 'Organization Admin' THEN 1
        WHEN 'Admin'              THEN 2
        ELSE 3
      END ASC
    LIMIT 1;


    IF v_my_org IS NULL THEN
      v_my_org := public.crm_org();
    END IF;
  END IF;

  IF v_my_org IS NULL THEN
    RAISE EXCEPTION 'Could not determine active company. Supply p_org_id explicitly.';
  END IF;

  -- Authorization check
  IF NOT (public.crm_is_company_admin(v_my_org) OR public.crm_is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized: Only Company Admins can add team members to this company';
  END IF;

  -- Role validation
  IF p_role = 'Super Admin' AND NOT public.crm_is_super_admin() THEN
    RAISE EXCEPTION 'Company Admins cannot create Super Admin members';
  END IF;

  IF p_role NOT IN (
    'Admin', 'Organization Admin', 'Manager', 'Sales Manager',
    'Team Leader', 'Executive', 'Sales Rep', 'Developer', 'Telecaller', 'Super Admin'
  ) THEN
    RAISE EXCEPTION 'Invalid role specified: %', p_role;
  END IF;

  -- Find or create auth.users entry
  SELECT id::text INTO v_user_id FROM auth.users WHERE email = v_clean_email;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid()::text;
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      v_user_id::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated', 'authenticated',
      v_clean_email,
      extensions.crypt(v_effective_pwd, extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_clean_name, 'name', v_clean_name),
      now(), now()
    );
  ELSE
    IF v_effective_pwd IS NOT NULL AND LENGTH(v_effective_pwd) >= 6 THEN
      UPDATE auth.users
      SET encrypted_password = extensions.crypt(v_effective_pwd, extensions.gen_salt('bf')),
          updated_at = now()
      WHERE id::text = v_user_id;
    END IF;
  END IF;

  -- Upsert profile
  INSERT INTO public.profiles (id, display_name, created_at)
  VALUES (v_user_id, v_clean_name, now())
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

  -- Assign role in the correct company org (wipe existing role in this org first)
  DELETE FROM public.user_roles
  WHERE user_id = v_user_id AND organization_id = v_my_org;

  INSERT INTO public.user_roles (id, user_id, organization_id, role)
  VALUES (gen_random_uuid()::text, v_user_id, v_my_org, p_role);

  -- Team assignment
  IF p_team_id IS NOT NULL AND TRIM(p_team_id) != '' THEN
    IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = p_team_id AND organization_id = v_my_org) THEN
      RAISE EXCEPTION 'Specified team does not belong to this company';
    END IF;
    DELETE FROM public.team_members WHERE user_id = v_user_id AND organization_id = v_my_org;
    INSERT INTO public.team_members (id, team_id, user_id, organization_id, created_at)
    VALUES (gen_random_uuid()::text, p_team_id, v_user_id, v_my_org, now())
    ON CONFLICT (team_id, user_id) DO NOTHING;
  END IF;

  -- Reporting line
  IF p_manager_id IS NOT NULL AND TRIM(p_manager_id) != '' THEN
    IF p_manager_id = v_user_id THEN
      RAISE EXCEPTION 'A team member cannot report to themselves';
    END IF;
    DELETE FROM public.reporting_lines WHERE executive_id = v_user_id AND organization_id = v_my_org;
    INSERT INTO public.reporting_lines (id, organization_id, manager_id, executive_id, created_at)
    VALUES (gen_random_uuid()::text, v_my_org, p_manager_id, v_user_id, now())
    ON CONFLICT (manager_id, executive_id) DO NOTHING;
  END IF;

  -- Audit log
  INSERT INTO public.company_audit_logs (actor_id, target_organization_id, action, details)
  VALUES (
    auth.uid()::text, v_my_org, 'CREATE_MEMBER',
    jsonb_build_object(
      'user_id', v_user_id, 'email', v_clean_email, 'name', v_clean_name,
      'role', p_role, 'team_id', p_team_id, 'manager_id', p_manager_id
    )
  );

  RETURN jsonb_build_object(
    'success', true, 'user_id', v_user_id, 'email', v_clean_email,
    'name', v_clean_name, 'role', p_role, 'organization_id', v_my_org
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_company_admin_create_member TO authenticated, service_role;

-- 3. REWRITE crm_super_admin_create_company (clean slate for new company admin)
DROP FUNCTION IF EXISTS public.crm_super_admin_create_company(text, text, text, text, text, text, text, text, text, text, text, text, text, text, bigint, text);
DROP FUNCTION IF EXISTS public.crm_super_admin_create_company(text, text, text, text);

CREATE OR REPLACE FUNCTION public.crm_super_admin_create_company(
  p_name            text,
  p_admin_email     text,
  p_admin_name      text,
  p_admin_password  text,
  p_website         text   DEFAULT NULL,
  p_phone           text   DEFAULT NULL,
  p_industry        text   DEFAULT NULL,
  p_address         text   DEFAULT NULL,
  p_city            text   DEFAULT NULL,
  p_state           text   DEFAULT NULL,
  p_country         text   DEFAULT 'India',
  p_tax_id          text   DEFAULT NULL,
  p_shift_start     text   DEFAULT '09:30 AM',
  p_shift_end       text   DEFAULT '06:30 PM',
  p_followup_days   bigint DEFAULT 1,
  p_plan            text   DEFAULT 'Enterprise'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_org_id      text;
  v_user_id     text;
  v_invite_code text;
  v_is_new_user boolean := false;
BEGIN
  IF NOT public.crm_is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only platform Super Admin can create companies';
  END IF;

  IF TRIM(p_name) = '' THEN RAISE EXCEPTION 'Company name cannot be empty'; END IF;
  IF TRIM(p_admin_email) = '' THEN RAISE EXCEPTION 'Company admin email cannot be empty'; END IF;

  v_invite_code := UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 10));

  -- 1. Create the company
  INSERT INTO public."Organization" (
    id, name, created_at, status, invite_code, auto_assign,
    followup_enabled, followup_days, rr_cursor, recording_retention_days,
    shift_start, shift_end, website, phone, industry, address,
    city, state, country, tax_id, plan
  ) VALUES (
    gen_random_uuid()::text, TRIM(p_name), now(), 'ACTIVE', v_invite_code, 'f', 't',
    COALESCE(p_followup_days, 1), 0, 90,
    COALESCE(p_shift_start, '09:30 AM'), COALESCE(p_shift_end, '06:30 PM'),
    NULLIF(TRIM(p_website), ''), NULLIF(TRIM(p_phone), ''),
    NULLIF(TRIM(p_industry), ''), NULLIF(TRIM(p_address), ''),
    NULLIF(TRIM(p_city), ''), NULLIF(TRIM(p_state), ''),
    COALESCE(NULLIF(TRIM(p_country), ''), 'India'),
    NULLIF(TRIM(p_tax_id), ''),
    COALESCE(NULLIF(TRIM(p_plan), ''), 'Enterprise')
  ) RETURNING id INTO v_org_id;

  -- 2. Find or create admin user
  SELECT id::text INTO v_user_id FROM auth.users WHERE email = LOWER(TRIM(p_admin_email));

  IF v_user_id IS NULL THEN
    v_is_new_user := true;
    v_user_id := gen_random_uuid()::text;
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      v_user_id::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated', 'authenticated',
      LOWER(TRIM(p_admin_email)),
      extensions.crypt(COALESCE(p_admin_password, 'Admin@12345'), extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', p_admin_name, 'name', p_admin_name, 'company', p_name, 'phone', p_phone),
      now(), now()
    );
  ELSE
    IF p_admin_password IS NOT NULL AND LENGTH(p_admin_password) >= 6 THEN
      UPDATE auth.users
      SET encrypted_password = extensions.crypt(p_admin_password, extensions.gen_salt('bf')),
          updated_at = now()
      WHERE id::text = v_user_id;
    END IF;
  END IF;

  -- 3. Wipe all NON-super-admin role rows for this user (clean slate)
  DELETE FROM public.user_roles
  WHERE user_id = v_user_id AND role NOT IN ('Super Admin');

  -- 4. Upsert profile
  INSERT INTO public.profiles (id, display_name, created_at)
  VALUES (v_user_id, COALESCE(NULLIF(TRIM(p_admin_name), ''), split_part(p_admin_email, '@', 1)), now())
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

  -- 5. Assign Admin role ONLY in the new company
  INSERT INTO public.user_roles (id, user_id, organization_id, role)
  VALUES (gen_random_uuid()::text, v_user_id, v_org_id, 'Admin')
  ON CONFLICT DO NOTHING;

  -- 6. Set org owner
  UPDATE public."Organization" SET owner_id = v_user_id WHERE id = v_org_id;

  -- 7. Audit log
  INSERT INTO public.company_audit_logs (actor_id, target_organization_id, action, details)
  VALUES (
    auth.uid()::text, v_org_id, 'CREATE_COMPANY',
    jsonb_build_object(
      'company_name', p_name, 'admin_email', p_admin_email,
      'admin_id', v_user_id, 'invite_code', v_invite_code,
      'plan', p_plan, 'new_user', v_is_new_user
    )
  );

  RETURN jsonb_build_object(
    'success', true, 'company_id', v_org_id, 'company_name', p_name,
    'admin_id', v_user_id, 'admin_email', p_admin_email, 'invite_code', v_invite_code
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_super_admin_create_company TO authenticated, anon, service_role;

-- 4. FIX crm_leaderboard - remove hardcoded org ID fallback
DROP FUNCTION IF EXISTS public.crm_leaderboard(text);
DROP FUNCTION IF EXISTS public.crm_leaderboard();

CREATE OR REPLACE FUNCTION public.crm_leaderboard(month_start text DEFAULT NULL)
RETURNS TABLE(user_id text, name text, deals bigint, revenue numeric, activities bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_org_id text;
  v_start  timestamptz;
  v_end    timestamptz;
BEGIN
  v_org_id := public.crm_org();
  IF v_org_id IS NULL THEN RETURN; END IF;

  IF month_start IS NULL OR TRIM(month_start) = '' THEN
    v_start := date_trunc('month', now());
    v_end   := v_start + INTERVAL '1 month';
  ELSE
    BEGIN
      v_start := (month_start || ' 00:00:00+00')::timestamptz;
      v_end   := v_start + INTERVAL '1 month';
    EXCEPTION WHEN OTHERS THEN
      v_start := date_trunc('month', now());
      v_end   := v_start + INTERVAL '1 month';
    END;
  END IF;

  RETURN QUERY
  WITH org_members AS (
    SELECT DISTINCT ur.user_id AS m_uid,
      COALESCE(p.display_name, split_part(au.email, '@', 1), 'Team Member') AS member_name
    FROM public.user_roles ur
    LEFT JOIN public.profiles p  ON p.id::text  = ur.user_id
    LEFT JOIN auth.users      au ON au.id::text = ur.user_id
    WHERE ur.organization_id = v_org_id
  ),
  mem_deals AS (
    SELECT sd.owner_id AS d_uid,
      COUNT(sd.id) AS deal_count,
      COALESCE(SUM(sd.total), 0) AS deal_revenue
    FROM public.sales_documents sd
    WHERE sd.organization_id = v_org_id
      AND sd.created_at >= v_start AND sd.created_at < v_end
    GROUP BY sd.owner_id
  ),
  mem_activities AS (
    SELECT a.owner_id AS a_uid, COUNT(a.id) AS act_count
    FROM public.activities a
    WHERE a.organization_id = v_org_id
      AND a.created_at::timestamptz >= v_start
      AND a.created_at::timestamptz <  v_end
    GROUP BY a.owner_id
  )
  SELECT m.m_uid, m.member_name,
    COALESCE(d.deal_count, 0)::bigint,
    COALESCE(d.deal_revenue, 0)::numeric,
    COALESCE(act.act_count, 0)::bigint
  FROM org_members m
  LEFT JOIN mem_deals      d   ON d.d_uid   = m.m_uid
  LEFT JOIN mem_activities act ON act.a_uid = m.m_uid
  ORDER BY 4 DESC, 3 DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.crm_leaderboard(text) TO authenticated, anon, service_role;

-- 5. RELOAD SCHEMA CACHE
NOTIFY pgrst, 'reload schema';
