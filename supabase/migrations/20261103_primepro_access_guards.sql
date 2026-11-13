-- REVIEW DRAFT ONLY: PrimePro access guards.
-- Do not apply to production. Reconcile this draft against the deployed schema
-- and validate in an isolated Supabase environment before any execution.
--
-- This migration adds restrictive policies without replacing existing CRM
-- policies, replaces three existing RPC definitions only to add role guards,
-- and narrows execution privileges on the bootstrap RPC. It does not update
-- or delete application records.
--
-- Rollback: drop the five primepro_* policies below, then restore the prior
-- crm_company_admin_create_member, crm_company_admin_manage_member, and
-- crm_leaderboard definitions and the original function ACLs from the
-- pre-migration database backup. Do not roll back by replaying the historical
-- migration chain.

BEGIN;

-- A restrictive policy is ANDed with existing permissive policies. It denies
-- developer access to financial rows without changing other roles' policies.
DROP POLICY IF EXISTS primepro_developer_sales_documents_select
  ON public.sales_documents;
CREATE POLICY primepro_developer_sales_documents_select
  ON public.sales_documents
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    NOT public.crm_is_developer()
    OR public.crm_is_super_admin()
  );

DROP POLICY IF EXISTS primepro_developer_payments_select
  ON public.payments;
CREATE POLICY primepro_developer_payments_select
  ON public.payments
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    NOT public.crm_is_developer()
    OR public.crm_is_super_admin()
  );

-- Prevent direct authenticated INSERT/UPDATE/DELETE from granting or editing
-- administrator roles or changing Super Admin role rows. SECURITY DEFINER
-- membership RPCs are guarded separately below.
DROP POLICY IF EXISTS primepro_user_roles_insert_guard
  ON public.user_roles;
CREATE POLICY primepro_user_roles_insert_guard
  ON public.user_roles
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    role <> 'Super Admin'
    AND (
      role NOT IN ('Admin', 'Organization Admin')
      OR public.crm_is_super_admin()
    )
  );

DROP POLICY IF EXISTS primepro_user_roles_update_guard
  ON public.user_roles;
CREATE POLICY primepro_user_roles_update_guard
  ON public.user_roles
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (
    role <> 'Super Admin'
    AND (
      role NOT IN ('Admin', 'Organization Admin')
      OR public.crm_is_super_admin()
    )
  )
  WITH CHECK (
    role <> 'Super Admin'
    AND (
      role NOT IN ('Admin', 'Organization Admin')
      OR public.crm_is_super_admin()
    )
  );

DROP POLICY IF EXISTS primepro_user_roles_delete_guard
  ON public.user_roles;
CREATE POLICY primepro_user_roles_delete_guard
  ON public.user_roles
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (
    role <> 'Super Admin'
    AND (
      role NOT IN ('Admin', 'Organization Admin')
      OR public.crm_is_super_admin()
    )
  );

-- Restrict the SECURITY DEFINER leaderboard itself; table RLS alone cannot
-- protect data returned by this function.
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
  IF public.crm_is_developer() AND NOT public.crm_is_super_admin() THEN
    RAISE EXCEPTION 'Developer role cannot access sales leaderboard data'
      USING ERRCODE = '42501';
  END IF;

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
    LEFT JOIN public.profiles p ON p.id::text = ur.user_id
    LEFT JOIN auth.users au ON au.id::text = ur.user_id
    WHERE ur.organization_id = v_org_id
  ),
  mem_deals AS (
    SELECT sd.owner_id AS d_uid,
      COUNT(sd.id) AS deal_count,
      COALESCE(SUM(sd.total), 0) AS deal_revenue
    FROM public.sales_documents sd
    WHERE sd.organization_id = v_org_id
      AND sd.created_at >= v_start
      AND sd.created_at < v_end
    GROUP BY sd.owner_id
  ),
  mem_activities AS (
    SELECT a.owner_id AS a_uid, COUNT(a.id) AS act_count
    FROM public.activities a
    WHERE a.organization_id = v_org_id
      AND a.created_at::timestamptz >= v_start
      AND a.created_at::timestamptz < v_end
    GROUP BY a.owner_id
  )
  SELECT m.m_uid,
    m.member_name,
    COALESCE(d.deal_count, 0)::bigint,
    COALESCE(d.deal_revenue, 0)::numeric,
    COALESCE(act.act_count, 0)::bigint
  FROM org_members m
  LEFT JOIN mem_deals d ON d.d_uid = m.m_uid
  LEFT JOIN mem_activities act ON act.a_uid = m.m_uid
  ORDER BY 4 DESC, 3 DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_leaderboard(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_leaderboard(text)
  TO authenticated, service_role;

-- Preserve the existing member-creation behavior while preventing company
-- admins from creating administrators and preventing this general-purpose RPC
-- from changing credentials/roles of an existing Super Admin.
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

  IF p_org_id IS NOT NULL AND TRIM(p_org_id) != '' THEN
    v_my_org := TRIM(p_org_id);
  ELSE
    SELECT organization_id INTO v_my_org
    FROM public.user_roles
    WHERE user_id = auth.uid()::text
      AND role IN ('Admin', 'Organization Admin')
    ORDER BY
      CASE role
        WHEN 'Organization Admin' THEN 1
        WHEN 'Admin' THEN 2
        ELSE 3
      END
    LIMIT 1;

    IF v_my_org IS NULL THEN
      v_my_org := public.crm_org();
    END IF;
  END IF;

  IF v_my_org IS NULL THEN
    RAISE EXCEPTION 'Could not determine active company. Supply p_org_id explicitly.';
  END IF;

  IF NOT (public.crm_is_company_admin(v_my_org) OR public.crm_is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized: Only Company Admins can add team members to this company';
  END IF;

  IF p_role IN ('Admin', 'Organization Admin')
    AND NOT public.crm_is_super_admin() THEN
    RAISE EXCEPTION 'Only Super Admins can create company administrators';
  END IF;

  IF p_role = 'Super Admin' THEN
    RAISE EXCEPTION 'Super Admin accounts cannot be created through this RPC';
  END IF;

  IF p_role NOT IN (
    'Admin', 'Organization Admin', 'Manager', 'Sales Manager',
    'Team Leader', 'Executive', 'Sales Executive', 'Sales Rep',
    'Developer', 'Telecaller', 'Super Admin'
  ) THEN
    RAISE EXCEPTION 'Invalid role specified: %', p_role;
  END IF;

  SELECT id::text INTO v_user_id
  FROM auth.users
  WHERE email = v_clean_email;

  IF v_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = v_user_id
      AND role = 'Super Admin'
  ) THEN
    RAISE EXCEPTION 'Super Admin accounts cannot be modified through this RPC';
  END IF;

  IF v_user_id IS NOT NULL
    AND NOT public.crm_is_super_admin()
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = v_user_id
        AND role IN ('Admin', 'Organization Admin')
    ) THEN
    RAISE EXCEPTION 'Only Super Admins can modify company administrator accounts';
  END IF;

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

  INSERT INTO public.profiles (id, display_name, created_at)
  VALUES (v_user_id, v_clean_name, now())
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

  DELETE FROM public.user_roles
  WHERE user_id = v_user_id AND organization_id = v_my_org;

  INSERT INTO public.user_roles (id, user_id, organization_id, role)
  VALUES (gen_random_uuid()::text, v_user_id, v_my_org, p_role);

  IF p_team_id IS NOT NULL AND TRIM(p_team_id) != '' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.teams
      WHERE id = p_team_id AND organization_id = v_my_org
    ) THEN
      RAISE EXCEPTION 'Specified team does not belong to this company';
    END IF;

    DELETE FROM public.team_members
    WHERE user_id = v_user_id AND organization_id = v_my_org;

    INSERT INTO public.team_members (id, team_id, user_id, organization_id, created_at)
    VALUES (gen_random_uuid()::text, p_team_id, v_user_id, v_my_org, now())
    ON CONFLICT (team_id, user_id) DO NOTHING;
  END IF;

  IF p_manager_id IS NOT NULL AND TRIM(p_manager_id) != '' THEN
    IF p_manager_id = v_user_id THEN
      RAISE EXCEPTION 'A team member cannot report to themselves';
    END IF;

    DELETE FROM public.reporting_lines
    WHERE executive_id = v_user_id AND organization_id = v_my_org;

    INSERT INTO public.reporting_lines (id, organization_id, manager_id, executive_id, created_at)
    VALUES (gen_random_uuid()::text, v_my_org, p_manager_id, v_user_id, now())
    ON CONFLICT (manager_id, executive_id) DO NOTHING;
  END IF;

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

GRANT EXECUTE ON FUNCTION public.crm_company_admin_create_member(
  text, text, text, text, text, text, text
) TO authenticated, service_role;

-- Preserve the existing member-management workflow while preventing non-Super
-- Admins from assigning admin roles or modifying administrator accounts.
CREATE OR REPLACE FUNCTION public.crm_company_admin_manage_member(
  p_user_id text,
  p_role text,
  p_team_id text DEFAULT NULL,
  p_manager_id text DEFAULT NULL,
  p_org_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  target_org text := COALESCE(NULLIF(p_org_id, ''), public.crm_org());
  current_role text;
  parent_role text;
BEGIN
  IF NOT public.crm_is_company_admin(target_org) THEN
    RAISE EXCEPTION 'Only company admins can manage company members';
  END IF;

  IF p_role NOT IN (
    'Admin', 'Organization Admin', 'Manager', 'Sales Manager', 'Team Leader',
    'Executive', 'Sales Executive', 'Sales Rep', 'Telecaller', 'Developer',
    'Super Admin'
  ) THEN
    RAISE EXCEPTION 'Invalid role specified: %', p_role;
  END IF;

  SELECT role INTO current_role
  FROM public.user_roles
  WHERE user_id = p_user_id
    AND organization_id = target_org
  LIMIT 1;

  IF current_role IS NULL THEN
    RAISE EXCEPTION 'Member does not belong to this company';
  END IF;

  IF current_role = 'Super Admin' OR p_role = 'Super Admin' THEN
    RAISE EXCEPTION 'Super Admin roles cannot be changed through this RPC';
  END IF;

  IF current_role IN ('Admin', 'Organization Admin')
    AND NOT public.crm_is_super_admin() THEN
    RAISE EXCEPTION 'Only Super Admins can modify company administrator accounts';
  END IF;

  IF p_role IN ('Admin', 'Organization Admin')
    AND NOT public.crm_is_super_admin() THEN
    RAISE EXCEPTION 'Only Super Admins can assign company administrator roles';
  END IF;

  IF p_team_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.teams
    WHERE id = p_team_id AND organization_id = target_org
  ) THEN
    RAISE EXCEPTION 'Specified team does not belong to this company';
  END IF;

  IF p_manager_id IS NOT NULL THEN
    SELECT role INTO parent_role
    FROM public.user_roles
    WHERE user_id = p_manager_id
      AND organization_id = target_org
    LIMIT 1;

    IF NOT (
      (parent_role IN ('Manager', 'Sales Manager', 'Team Leader')
        AND p_role IN ('Executive', 'Sales Executive', 'Sales Rep', 'Telecaller'))
      OR (parent_role IN ('Executive', 'Sales Executive', 'Sales Rep', 'Telecaller')
        AND p_role = 'Developer')
    ) THEN
      RAISE EXCEPTION 'Reporting lines must follow Manager to Executive to Developer';
    END IF;
  END IF;

  UPDATE public.user_roles
  SET role = p_role
  WHERE user_id = p_user_id
    AND organization_id = target_org;

  DELETE FROM public.team_members
  WHERE user_id = p_user_id
    AND organization_id = target_org;

  IF p_team_id IS NOT NULL THEN
    INSERT INTO public.team_members (id, team_id, user_id, organization_id)
    VALUES (gen_random_uuid()::text, p_team_id, p_user_id, target_org);
  END IF;

  DELETE FROM public.reporting_lines
  WHERE executive_id = p_user_id
    AND organization_id = target_org;

  IF p_manager_id IS NOT NULL THEN
    INSERT INTO public.reporting_lines (id, organization_id, manager_id, executive_id)
    VALUES (gen_random_uuid()::text, target_org, p_manager_id, p_user_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'role', p_role,
    'team_id', p_team_id,
    'manager_id', p_manager_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_company_admin_manage_member(
  text, text, text, text, text
) TO authenticated, service_role;

-- Bootstrap is not used by the application source. Limit this no-caller-check
-- SECURITY DEFINER RPC to trusted server administration. Verify that initial
-- bootstrap is performed through service_role before applying this grant.
REVOKE EXECUTE ON FUNCTION public.crm_bootstrap_super_admin(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_bootstrap_super_admin(text)
  TO service_role;

COMMIT;
