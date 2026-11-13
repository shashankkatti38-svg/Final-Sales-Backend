-- ============================================================================
-- SALESWORKS360 CRM: MULTI-COMPANY TENANT ISOLATION & COMPANY ADMIN USER FLOW
-- Migration: 20261027_company_login_flow_and_tenant_zero_data.sql
-- ============================================================================

-- 1. HARDEN SALES DOCUMENTS RLS (Remove leaky "OR true" and "anon" policies)
ALTER TABLE public.sales_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_sales_documents_delete" ON public.sales_documents;
DROP POLICY IF EXISTS "anon_sales_documents_insert" ON public.sales_documents;
DROP POLICY IF EXISTS "anon_sales_documents_select" ON public.sales_documents;
DROP POLICY IF EXISTS "anon_sales_documents_update" ON public.sales_documents;
DROP POLICY IF EXISTS "sales_documents_org_policy" ON public.sales_documents;

CREATE POLICY "sales_documents_tenant_isolation" ON public.sales_documents
  FOR ALL TO authenticated
  USING (
    public.crm_is_super_admin() OR organization_id = public.crm_org()
  )
  WITH CHECK (
    public.crm_is_super_admin() OR organization_id = public.crm_org()
  );

-- 2. HARDEN PAYMENTS RLS (Remove leaky "OR true" and "anon" policies)
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_payments_all" ON public.payments;
DROP POLICY IF EXISTS "payments_org_policy" ON public.payments;

CREATE POLICY "payments_tenant_isolation" ON public.payments
  FOR ALL TO authenticated
  USING (
    public.crm_is_super_admin() OR organization_id = public.crm_org()
  )
  WITH CHECK (
    public.crm_is_super_admin() OR organization_id = public.crm_org()
  );

-- 3. HARDEN LOCATION CHECKINS RLS (Remove leaky "OR true")
ALTER TABLE public.location_checkins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_location_checkins_delete" ON public.location_checkins;
DROP POLICY IF EXISTS "anon_location_checkins_insert" ON public.location_checkins;
DROP POLICY IF EXISTS "anon_location_checkins_select" ON public.location_checkins;
DROP POLICY IF EXISTS "anon_location_checkins_update" ON public.location_checkins;
DROP POLICY IF EXISTS "location_checkins_org_policy" ON public.location_checkins;

CREATE POLICY "location_checkins_tenant_isolation" ON public.location_checkins
  FOR ALL TO authenticated
  USING (
    public.crm_is_super_admin() OR organization_id = public.crm_org()
  )
  WITH CHECK (
    public.crm_is_super_admin() OR organization_id = public.crm_org()
  );

-- 4. HARDEN CALL LOGS RLS (Remove open true select)
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_call_logs_delete" ON public.call_logs;
DROP POLICY IF EXISTS "anon_call_logs_insert" ON public.call_logs;
DROP POLICY IF EXISTS "anon_call_logs_select" ON public.call_logs;
DROP POLICY IF EXISTS "anon_call_logs_update" ON public.call_logs;
DROP POLICY IF EXISTS "anon_calls_select" ON public.call_logs;
DROP POLICY IF EXISTS "call_logs_authenticated_select" ON public.call_logs;
DROP POLICY IF EXISTS "call_logs_authenticated_insert" ON public.call_logs;
DROP POLICY IF EXISTS "call_logs_authenticated_update" ON public.call_logs;
DROP POLICY IF EXISTS "call_logs_org_policy" ON public.call_logs;

CREATE POLICY "call_logs_tenant_isolation" ON public.call_logs
  FOR ALL TO authenticated
  USING (
    public.crm_is_super_admin() OR organization_id = public.crm_org()
  )
  WITH CHECK (
    public.crm_is_super_admin() OR organization_id = public.crm_org()
  );

-- 5. HARDEN LEADS RLS (Drop open anon select)
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_leads_delete" ON public.leads;
DROP POLICY IF EXISTS "anon_leads_insert" ON public.leads;
DROP POLICY IF EXISTS "anon_leads_select" ON public.leads;
DROP POLICY IF EXISTS "anon_leads_update" ON public.leads;
DROP POLICY IF EXISTS "leads_select_policy" ON public.leads;
DROP POLICY IF EXISTS "leads_insert_policy" ON public.leads;
DROP POLICY IF EXISTS "leads_update_policy" ON public.leads;
DROP POLICY IF EXISTS "leads_delete_policy" ON public.leads;

CREATE POLICY "leads_tenant_select" ON public.leads
  FOR SELECT TO authenticated
  USING (
    public.crm_is_super_admin() OR (
      organization_id = public.crm_org() AND (
        public.crm_is_company_admin(organization_id)
        OR public.crm_is_manager(organization_id)
        OR (owner_id = auth.uid()::text)
        OR (assigned_to = auth.uid()::text)
        OR (owner_id IS NULL AND assigned_to IS NULL)
      )
    )
  );

CREATE POLICY "leads_tenant_insert" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (
    public.crm_is_super_admin() OR organization_id = public.crm_org()
  );

CREATE POLICY "leads_tenant_update" ON public.leads
  FOR UPDATE TO authenticated
  USING (
    public.crm_is_super_admin() OR (
      organization_id = public.crm_org() AND (
        public.crm_is_company_admin(organization_id)
        OR public.crm_is_manager(organization_id)
        OR (owner_id = auth.uid()::text)
        OR (assigned_to = auth.uid()::text)
      )
    )
  )
  WITH CHECK (
    public.crm_is_super_admin() OR organization_id = public.crm_org()
  );

CREATE POLICY "leads_tenant_delete" ON public.leads
  FOR DELETE TO authenticated
  USING (
    public.crm_is_super_admin() OR (
      organization_id = public.crm_org() AND public.crm_is_company_admin(organization_id)
    )
  );

-- 6. HARDEN TASKS RLS (Drop open anon select)
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_tasks_delete" ON public.tasks;
DROP POLICY IF EXISTS "anon_tasks_insert" ON public.tasks;
DROP POLICY IF EXISTS "anon_tasks_select" ON public.tasks;
DROP POLICY IF EXISTS "anon_tasks_update" ON public.tasks;

-- 7. HARDEN ACTIVITIES RLS (Drop open anon select)
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_activities_delete" ON public.activities;
DROP POLICY IF EXISTS "anon_activities_insert" ON public.activities;
DROP POLICY IF EXISTS "anon_activities_select" ON public.activities;
DROP POLICY IF EXISTS "anon_activities_update" ON public.activities;

-- 8. UPDATE CRM_COMPANY_ADMIN_CREATE_MEMBER RPC WITH SEARCH_PATH & EXTENSIONS.CRYPT
DROP FUNCTION IF EXISTS public.crm_company_admin_create_member(text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.crm_company_admin_create_member(
  p_email text,
  p_name text,
  p_password text DEFAULT 'Member@12345',
  p_role text DEFAULT 'Executive',
  p_team_id text DEFAULT NULL,
  p_manager_id text DEFAULT NULL,
  p_org_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_my_org text;
  v_user_id text;
  v_clean_email text;
  v_clean_name text;
  v_effective_pwd text;
BEGIN
  v_clean_email := LOWER(TRIM(p_email));
  v_clean_name := TRIM(p_name);
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
    SELECT organization_id INTO v_my_org
    FROM public.user_roles
    WHERE user_id = auth.uid()::text
      AND role IN ('Admin', 'Organization Admin')
    ORDER BY (organization_id != '4df15334-08f1-4ea8-a764-c36266fbfdba') DESC
    LIMIT 1;

    IF v_my_org IS NULL THEN
      v_my_org := public.crm_org();
    END IF;
  END IF;

  IF v_my_org IS NULL THEN
    RAISE EXCEPTION 'Could not determine active company organization';
  END IF;

  -- Verify caller is Company Admin of this org or Super Admin
  IF NOT (public.crm_is_company_admin(v_my_org) OR public.crm_is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized: Only Company Admins can add team members to this company';
  END IF;

  -- Validate role
  IF p_role = 'Super Admin' AND NOT public.crm_is_super_admin() THEN
    RAISE EXCEPTION 'Company Admins cannot create Super Admin members';
  END IF;

  IF p_role NOT IN ('Admin', 'Organization Admin', 'Manager', 'Sales Manager', 'Team Leader', 'Executive', 'Sales Rep', 'Developer', 'Telecaller', 'Super Admin') THEN
    RAISE EXCEPTION 'Invalid role specified: %', p_role;
  END IF;

  -- Check if user already exists in auth.users
  SELECT id::text INTO v_user_id FROM auth.users WHERE email = v_clean_email;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid()::text;
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      v_user_id::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated',
      'authenticated',
      v_clean_email,
      extensions.crypt(v_effective_pwd, extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_clean_name, 'name', v_clean_name),
      now(),
      now()
    );
  ELSE
    -- If user already exists, update their password so they can log in
    IF v_effective_pwd IS NOT NULL AND LENGTH(v_effective_pwd) >= 6 THEN
      UPDATE auth.users 
      SET encrypted_password = extensions.crypt(v_effective_pwd, extensions.gen_salt('bf')), updated_at = now()
      WHERE id::text = v_user_id;
    END IF;
  END IF;

  -- Upsert profile
  INSERT INTO public.profiles (id, display_name, created_at)
  VALUES (v_user_id, v_clean_name, now())
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

  -- Assign user role in this organization
  DELETE FROM public.user_roles 
  WHERE user_id = v_user_id AND organization_id = '4df15334-08f1-4ea8-a764-c36266fbfdba' AND v_my_org != '4df15334-08f1-4ea8-a764-c36266fbfdba';

  DELETE FROM public.user_roles WHERE user_id = v_user_id AND organization_id = v_my_org;

  INSERT INTO public.user_roles (id, user_id, organization_id, role)
  VALUES (gen_random_uuid()::text, v_user_id, v_my_org, p_role);

  -- Assign Team if provided
  IF p_team_id IS NOT NULL AND TRIM(p_team_id) != '' THEN
    IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = p_team_id AND organization_id = v_my_org) THEN
      RAISE EXCEPTION 'Specified team does not belong to this company';
    END IF;

    DELETE FROM public.team_members WHERE user_id = v_user_id AND organization_id = v_my_org;
    INSERT INTO public.team_members (id, team_id, user_id, organization_id, created_at)
    VALUES (gen_random_uuid()::text, p_team_id, v_user_id, v_my_org, now())
    ON CONFLICT (team_id, user_id) DO NOTHING;
  END IF;

  -- Assign Manager Reporting Line if provided
  IF p_manager_id IS NOT NULL AND TRIM(p_manager_id) != '' THEN
    IF p_manager_id = v_user_id THEN
      RAISE EXCEPTION 'A team member cannot report to themselves';
    END IF;

    DELETE FROM public.reporting_lines WHERE executive_id = v_user_id AND organization_id = v_my_org;
    INSERT INTO public.reporting_lines (id, organization_id, manager_id, executive_id, created_at)
    VALUES (gen_random_uuid()::text, v_my_org, p_manager_id, v_user_id, now())
    ON CONFLICT (manager_id, executive_id) DO NOTHING;
  END IF;

  -- Log in company_audit_logs
  INSERT INTO public.company_audit_logs (actor_id, target_organization_id, action, details)
  VALUES (
    auth.uid()::text, v_my_org, 'CREATE_MEMBER',
    jsonb_build_object(
      'user_id', v_user_id,
      'email', v_clean_email,
      'name', v_clean_name,
      'role', p_role,
      'team_id', p_team_id,
      'manager_id', p_manager_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'email', v_clean_email,
    'name', v_clean_name,
    'role', p_role,
    'organization_id', v_my_org
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_company_admin_create_member TO authenticated, service_role;

-- 9. RELOAD SCHEMA CACHE
NOTIFY pgrst, 'reload schema';
