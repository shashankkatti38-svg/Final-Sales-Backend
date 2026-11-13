-- ============================================================================
-- SALESWORKS360 CRM: ADD TEAM MEMBER RPC FOR COMPANY ADMINS & SUPER ADMINS
-- Migration: 20261026_add_team_member_rpc.sql
-- ============================================================================

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
AS $$
DECLARE
  v_my_org text;
  v_user_id text;
  v_clean_email text;
  v_clean_name text;
BEGIN
  v_clean_email := LOWER(TRIM(p_email));
  v_clean_name := TRIM(p_name);

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

  IF p_role NOT IN ('Admin', 'Organization Admin', 'Manager', 'Sales Manager', 'Team Leader', 'Executive', 'Sales Rep', 'Developer', 'Super Admin') THEN
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
      crypt(COALESCE(p_password, 'Member@12345'), gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_clean_name, 'name', v_clean_name),
      now(),
      now()
    );
  END IF;

  -- Upsert profile
  INSERT INTO public.profiles (id, display_name, created_at)
  VALUES (v_user_id, v_clean_name, now())
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

  -- Assign user role in this organization
  -- Remove default fallback org role if exists
  DELETE FROM public.user_roles 
  WHERE user_id = v_user_id AND organization_id = '4df15334-08f1-4ea8-a764-c36266fbfdba' AND v_my_org != '4df15334-08f1-4ea8-a764-c36266fbfdba';

  INSERT INTO public.user_roles (id, user_id, organization_id, role)
  VALUES (gen_random_uuid()::text, v_user_id, v_my_org, p_role)
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, organization_id = EXCLUDED.organization_id;

  UPDATE public.user_roles SET role = p_role WHERE user_id = v_user_id AND organization_id = v_my_org;

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
