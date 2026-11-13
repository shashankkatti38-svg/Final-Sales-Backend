-- ============================================================================
-- SALESWORKS360 CRM: FIX 4 ERRORS, MULTI-COMPANY RPCS & DEPARTMENTS
-- Migration: 20261027_fix_four_errors_and_departments.sql
-- ============================================================================

-- 1. DEPARTMENTS TABLE & RELATIONSHIPS
CREATE TABLE IF NOT EXISTS public.departments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id text NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'ACTIVE',
  manager_id text REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.teams 
ADD COLUMN IF NOT EXISTS department_id text REFERENCES public.departments(id) ON DELETE SET NULL;

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "departments_tenant_isolation" ON public.departments;
CREATE POLICY "departments_tenant_isolation" ON public.departments
  FOR ALL TO authenticated
  USING (
    public.crm_is_super_admin() OR organization_id = public.crm_org()
  )
  WITH CHECK (
    public.crm_is_super_admin() OR (
      organization_id = public.crm_org() AND (public.crm_is_company_admin() OR public.crm_is_manager())
    )
  );

GRANT ALL ON public.departments TO authenticated, service_role;
GRANT SELECT ON public.departments TO anon;

-- 2. FIX CRM LEADERBOARD WITH DEFAULT PARAMETER
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
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  -- Get caller's active organization
  v_org_id := public.crm_org();
  IF v_org_id IS NULL THEN
    SELECT ur.organization_id INTO v_org_id 
    FROM public.user_roles ur 
    WHERE ur.user_id = auth.uid()::text 
    LIMIT 1;
  END IF;

  -- If still null, fallback to primary default org
  IF v_org_id IS NULL THEN
    v_org_id := '4df15334-08f1-4ea8-a764-c36266fbfdba';
  END IF;

  -- Parse month bounds
  IF month_start IS NULL OR TRIM(month_start) = '' THEN
    v_start := date_trunc('month', now());
    v_end := v_start + INTERVAL '1 month';
  ELSE
    BEGIN
      v_start := (month_start || ' 00:00:00+00')::timestamptz;
      v_end := v_start + INTERVAL '1 month';
    EXCEPTION WHEN OTHERS THEN
      v_start := date_trunc('month', now());
      v_end := v_start + INTERVAL '1 month';
    END;
  END IF;

  RETURN QUERY
  WITH org_members AS (
    SELECT DISTINCT ur.user_id as m_uid, COALESCE(p.display_name, split_part(au.email, '@', 1), 'Team Member') as member_name
    FROM public.user_roles ur
    LEFT JOIN public.profiles p ON p.id::text = ur.user_id
    LEFT JOIN auth.users au ON au.id::text = ur.user_id
    WHERE ur.organization_id = v_org_id
  ),
  mem_deals AS (
    SELECT 
      sd.owner_id as d_uid,
      COUNT(sd.id) as deal_count,
      COALESCE(SUM(sd.total), 0) as deal_revenue
    FROM public.sales_documents sd
    WHERE sd.organization_id = v_org_id
      AND sd.created_at >= v_start
      AND sd.created_at < v_end
    GROUP BY sd.owner_id
  ),
  mem_activities AS (
    SELECT 
      a.owner_id as a_uid,
      COUNT(a.id) as act_count
    FROM public.activities a
    WHERE a.organization_id = v_org_id
      AND a.created_at::timestamptz >= v_start
      AND a.created_at::timestamptz < v_end
    GROUP BY a.owner_id
  )
  SELECT 
    m.m_uid as user_id,
    m.member_name as name,
    COALESCE(d.deal_count, 0)::bigint as deals,
    COALESCE(d.deal_revenue, 0)::numeric as revenue,
    COALESCE(act.act_count, 0)::bigint as activities
  FROM org_members m
  LEFT JOIN mem_deals d ON d.d_uid = m.m_uid
  LEFT JOIN mem_activities act ON act.a_uid = m.m_uid
  ORDER BY revenue DESC, deals DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.crm_leaderboard(text) TO authenticated, anon, service_role;

-- 3. FIX SUPER ADMIN CREATE COMPANY RPC (Drop duplicate signature, qualify pgcrypto, default params)
DROP FUNCTION IF EXISTS public.crm_super_admin_create_company(text, text, text, text, text, text, text, text, text, text, text, text, text, text, bigint, text);
DROP FUNCTION IF EXISTS public.crm_super_admin_create_company(text, text, text, text);

CREATE OR REPLACE FUNCTION public.crm_super_admin_create_company(
  p_name text,
  p_admin_email text,
  p_admin_name text,
  p_admin_password text,
  p_website text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_country text DEFAULT 'India',
  p_tax_id text DEFAULT NULL,
  p_shift_start text DEFAULT '09:30 AM',
  p_shift_end text DEFAULT '06:30 PM',
  p_followup_days bigint DEFAULT 1,
  p_plan text DEFAULT 'Enterprise'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_org_id text;
  v_user_id text;
  v_invite_code text;
BEGIN
  IF NOT public.crm_is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only platform Super Admin can create companies';
  END IF;

  IF TRIM(p_name) = '' THEN
    RAISE EXCEPTION 'Company name cannot be empty';
  END IF;

  IF TRIM(p_admin_email) = '' THEN
    RAISE EXCEPTION 'Company admin email cannot be empty';
  END IF;

  v_invite_code := UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 10));

  -- 1. Create company in physical table
  INSERT INTO public."Organization" (
    id, name, created_at, status, invite_code, auto_assign, followup_enabled, followup_days, rr_cursor, recording_retention_days,
    shift_start, shift_end, website, phone, industry, address, city, state, country, tax_id, plan
  ) VALUES (
    gen_random_uuid()::text, TRIM(p_name), now(), 'ACTIVE', v_invite_code, 'f', 't', COALESCE(p_followup_days, 1), 0, 90,
    COALESCE(p_shift_start, '09:30 AM'), COALESCE(p_shift_end, '06:30 PM'),
    NULLIF(TRIM(p_website), ''), NULLIF(TRIM(p_phone), ''), NULLIF(TRIM(p_industry), ''),
    NULLIF(TRIM(p_address), ''), NULLIF(TRIM(p_city), ''), NULLIF(TRIM(p_state), ''),
    COALESCE(NULLIF(TRIM(p_country), ''), 'India'), NULLIF(TRIM(p_tax_id), ''), COALESCE(NULLIF(TRIM(p_plan), ''), 'Enterprise')
  ) RETURNING id INTO v_org_id;

  -- 2. Find or create user in auth.users
  SELECT id::text INTO v_user_id FROM auth.users WHERE email = LOWER(TRIM(p_admin_email));

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid()::text;
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      v_user_id::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated',
      'authenticated',
      LOWER(TRIM(p_admin_email)),
      extensions.crypt(COALESCE(p_admin_password, 'Admin@12345'), extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', p_admin_name, 'name', p_admin_name, 'company', p_name, 'phone', p_phone),
      now(),
      now()
    );
  ELSE
    IF p_admin_password IS NOT NULL AND LENGTH(p_admin_password) >= 6 THEN
      UPDATE auth.users 
      SET encrypted_password = extensions.crypt(p_admin_password, extensions.gen_salt('bf')), updated_at = now()
      WHERE id::text = v_user_id;
    END IF;
  END IF;

  DELETE FROM public.user_roles 
  WHERE user_id = v_user_id AND organization_id = '4df15334-08f1-4ea8-a764-c36266fbfdba';

  INSERT INTO public.profiles (id, display_name, created_at)
  VALUES (v_user_id, COALESCE(NULLIF(TRIM(p_admin_name), ''), split_part(p_admin_email, '@', 1)), now())
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

  INSERT INTO public.user_roles (id, user_id, organization_id, role)
  VALUES (gen_random_uuid()::text, v_user_id, v_org_id, 'Admin')
  ON CONFLICT DO NOTHING;

  UPDATE public."Organization" SET owner_id = v_user_id WHERE id = v_org_id;

  INSERT INTO public.company_audit_logs (actor_id, target_organization_id, action, details)
  VALUES (
    auth.uid()::text, v_org_id, 'CREATE_COMPANY',
    jsonb_build_object(
      'company_name', p_name,
      'admin_email', p_admin_email,
      'admin_id', v_user_id,
      'invite_code', v_invite_code,
      'plan', p_plan
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'company_id', v_org_id,
    'company_name', p_name,
    'admin_id', v_user_id,
    'admin_email', p_admin_email,
    'invite_code', v_invite_code
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_super_admin_create_company TO authenticated, anon, service_role;

-- 4. FIX SUPER ADMIN UPDATE CREDENTIALS RPC
DROP FUNCTION IF EXISTS public.crm_super_admin_update_user_credentials(text, text, text, text);
DROP FUNCTION IF EXISTS public.crm_super_admin_update_user_credentials(text, text, text);

CREATE OR REPLACE FUNCTION public.crm_super_admin_update_user_credentials(
  p_user_id text,
  p_new_email text DEFAULT NULL,
  p_temp_password text DEFAULT NULL,
  p_new_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_old_email text;
  v_target_role text;
  v_effective_pwd text;
BEGIN
  IF NOT public.crm_is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only platform Super Admin can manage user credentials';
  END IF;

  SELECT role INTO v_target_role FROM public.user_roles WHERE user_id = p_user_id LIMIT 1;
  IF v_target_role = 'Super Admin' AND auth.uid()::text != p_user_id THEN
    RAISE EXCEPTION 'Cannot modify credentials of another Super Admin account';
  END IF;

  SELECT email INTO v_old_email FROM auth.users WHERE id::text = p_user_id;
  IF v_old_email IS NULL THEN
    RAISE EXCEPTION 'User not found in auth.users';
  END IF;

  IF p_new_email IS NOT NULL AND TRIM(p_new_email) != '' THEN
    UPDATE auth.users 
    SET email = LOWER(TRIM(p_new_email)), updated_at = now()
    WHERE id::text = p_user_id;
  END IF;

  v_effective_pwd := COALESCE(p_new_password, p_temp_password);
  IF v_effective_pwd IS NOT NULL AND LENGTH(v_effective_pwd) >= 6 THEN
    UPDATE auth.users 
    SET encrypted_password = extensions.crypt(v_effective_pwd, extensions.gen_salt('bf')), updated_at = now()
    WHERE id::text = p_user_id;
  END IF;

  INSERT INTO public.company_audit_logs (actor_id, target_organization_id, action, details)
  VALUES (
    auth.uid()::text, NULL, 'UPDATE_USER_CREDENTIALS',
    jsonb_build_object(
      'target_user_id', p_user_id,
      'old_email', v_old_email,
      'new_email', p_new_email,
      'password_reset', (v_effective_pwd IS NOT NULL)
    )
  );

  RETURN jsonb_build_object('success', true, 'user_id', p_user_id, 'updated', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_super_admin_update_user_credentials TO authenticated, anon, service_role;

-- 5. RELOAD SCHEMA CACHE
NOTIFY pgrst, 'reload schema';
