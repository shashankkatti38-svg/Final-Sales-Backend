-- ============================================================================
-- SALESWORKS360 CRM: SECURITY DEFINER RPCS FOR SUPER ADMIN & TASK OPERATIONS
-- Migration: 20261026_super_admin_rpc_and_task_ops.sql
-- ============================================================================

-- 1. SUPER ADMIN: CREATE COMPANY & FIRST ADMIN
CREATE OR REPLACE FUNCTION public.crm_super_admin_create_company(
  p_name text,
  p_admin_email text,
  p_admin_name text,
  p_admin_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id text;
  v_user_id text;
  v_invite_code text;
BEGIN
  -- Strict Super Admin authorization check
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
    id, name, created_at, status, invite_code, auto_assign, followup_enabled, followup_days, rr_cursor, recording_retention_days, shift_start
  ) VALUES (
    gen_random_uuid()::text, TRIM(p_name), now(), 'ACTIVE', v_invite_code, 'f', 't', 1, 0, 90, '10:00:00'
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
      crypt(COALESCE(p_admin_password, 'Admin@12345'), gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', p_admin_name, 'name', p_admin_name, 'company', p_name),
      now(),
      now()
    );
  END IF;

  -- Remove default organization assignment created by signup trigger
  DELETE FROM public.user_roles 
  WHERE user_id = v_user_id AND organization_id = '4df15334-08f1-4ea8-a764-c36266fbfdba';

  -- 3. Upsert Profile
  INSERT INTO public.profiles (id, display_name, created_at)
  VALUES (v_user_id, COALESCE(NULLIF(TRIM(p_admin_name), ''), split_part(p_admin_email, '@', 1)), now())
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

  -- 4. Create Admin Role for this company
  INSERT INTO public.user_roles (id, user_id, organization_id, role)
  VALUES (gen_random_uuid()::text, v_user_id, v_org_id, 'Admin')
  ON CONFLICT DO NOTHING;

  -- Update owner_id of the organization
  UPDATE public."Organization" SET owner_id = v_user_id WHERE id = v_org_id;

  -- 5. Write audit log
  INSERT INTO public.company_audit_logs (actor_id, target_organization_id, action, details)
  VALUES (
    auth.uid()::text, v_org_id, 'CREATE_COMPANY',
    jsonb_build_object(
      'company_name', p_name,
      'admin_email', p_admin_email,
      'admin_id', v_user_id,
      'invite_code', v_invite_code
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

-- 2. SUPER ADMIN: UPDATE COMPANY
CREATE OR REPLACE FUNCTION public.crm_super_admin_update_company(
  p_org_id text,
  p_name text,
  p_status text DEFAULT 'ACTIVE',
  p_followup_days bigint DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.crm_is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only platform Super Admin can modify companies';
  END IF;

  IF p_status NOT IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED') THEN
    RAISE EXCEPTION 'Invalid company status: %', p_status;
  END IF;

  UPDATE public."Organization"
  SET 
    name = COALESCE(NULLIF(TRIM(p_name), ''), name),
    status = p_status,
    followup_days = COALESCE(p_followup_days, followup_days)
  WHERE id = p_org_id;

  INSERT INTO public.company_audit_logs (actor_id, target_organization_id, action, details)
  VALUES (
    auth.uid()::text, p_org_id, 'UPDATE_COMPANY',
    jsonb_build_object('name', p_name, 'status', p_status, 'followup_days', p_followup_days)
  );

  RETURN jsonb_build_object('success', true, 'company_id', p_org_id, 'status', p_status);
END;
$$;

-- 3. SUPER ADMIN: SOFT-DELETE & RESTORE COMPANY
CREATE OR REPLACE FUNCTION public.crm_super_admin_soft_delete_company(p_org_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.crm_is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only platform Super Admin can deactivate companies';
  END IF;

  UPDATE public."Organization"
  SET deleted_at = now(), status = 'DEACTIVATED'
  WHERE id = p_org_id;

  INSERT INTO public.company_audit_logs (actor_id, target_organization_id, action, details)
  VALUES (auth.uid()::text, p_org_id, 'SOFT_DELETE_COMPANY', jsonb_build_object('timestamp', now()));

  RETURN jsonb_build_object('success', true, 'company_id', p_org_id, 'deleted', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_super_admin_restore_company(p_org_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.crm_is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only platform Super Admin can restore companies';
  END IF;

  UPDATE public."Organization"
  SET deleted_at = NULL, status = 'ACTIVE'
  WHERE id = p_org_id;

  INSERT INTO public.company_audit_logs (actor_id, target_organization_id, action, details)
  VALUES (auth.uid()::text, p_org_id, 'RESTORE_COMPANY', jsonb_build_object('timestamp', now()));

  RETURN jsonb_build_object('success', true, 'company_id', p_org_id, 'restored', true);
END;
$$;

-- 4. SUPER ADMIN: MANAGE USER CREDENTIALS (Email & Password Reset / Temporary Password)
CREATE OR REPLACE FUNCTION public.crm_super_admin_update_user_credentials(
  p_user_id text,
  p_new_email text DEFAULT NULL,
  p_temp_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old_email text;
  v_target_role text;
BEGIN
  IF NOT public.crm_is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only platform Super Admin can manage user credentials';
  END IF;

  -- Safety rule: Super Admin cannot be removed or demoted through normal credential updates
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

  IF p_temp_password IS NOT NULL AND LENGTH(p_temp_password) >= 6 THEN
    UPDATE auth.users 
    SET encrypted_password = crypt(p_temp_password, gen_salt('bf')), updated_at = now()
    WHERE id::text = p_user_id;
  END IF;

  INSERT INTO public.company_audit_logs (actor_id, target_organization_id, action, details)
  VALUES (
    auth.uid()::text, NULL, 'UPDATE_USER_CREDENTIALS',
    jsonb_build_object(
      'target_user_id', p_user_id,
      'old_email', v_old_email,
      'new_email', p_new_email,
      'password_reset', (p_temp_password IS NOT NULL)
    )
  );

  RETURN jsonb_build_object('success', true, 'user_id', p_user_id, 'updated', true);
END;
$$;

-- 5. SUPER ADMIN: AUDITED CROSS-COMPANY ACCESS
CREATE OR REPLACE FUNCTION public.crm_super_admin_log_access(
  p_target_org_id text,
  p_action text,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.crm_is_super_admin() THEN
    RETURN false;
  END IF;

  INSERT INTO public.company_audit_logs (actor_id, target_organization_id, action, details)
  VALUES (auth.uid()::text, p_target_org_id, p_action, p_details);

  RETURN true;
END;
$$;

-- 6. COMPANY ADMIN: MANAGE USER ROLES, TEAMS & REPORTING LINES
DROP FUNCTION IF EXISTS public.crm_company_admin_manage_member(text, text, text, text);

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
AS $$
DECLARE
  v_my_org text;
  v_target_user_org text;
  v_target_existing_role text;
BEGIN
  IF p_org_id IS NOT NULL THEN
    v_my_org := p_org_id;
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

  -- Verify caller is Admin or Super Admin
  IF NOT (public.crm_is_company_admin(v_my_org) OR public.crm_is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized: Only Company Admins can manage company users and roles';
  END IF;

  -- Rule: Company Admin CANNOT promote anyone to Super Admin
  IF p_role = 'Super Admin' AND NOT public.crm_is_super_admin() THEN
    RAISE EXCEPTION 'Company Admins cannot grant Super Admin role';
  END IF;

  -- Rule: Valid roles check
  IF p_role NOT IN ('Admin', 'Organization Admin', 'Manager', 'Sales Manager', 'Team Leader', 'Executive', 'Sales Rep', 'Developer', 'Super Admin') THEN
    RAISE EXCEPTION 'Invalid role specified: %', p_role;
  END IF;

  -- Rule: Cannot demote or edit Super Admin
  SELECT role, organization_id INTO v_target_existing_role, v_target_user_org 
  FROM public.user_roles 
  WHERE user_id = p_user_id 
  LIMIT 1;

  IF v_target_existing_role = 'Super Admin' AND NOT public.crm_is_super_admin() THEN
    RAISE EXCEPTION 'Company Admins cannot edit or demote a Super Admin account';
  END IF;

  -- Ensure user belongs to same company (unless Super Admin)
  IF v_target_user_org IS NOT NULL AND v_target_user_org != v_my_org AND NOT public.crm_is_super_admin() THEN
    RAISE EXCEPTION 'Cannot manage users from another company';
  END IF;

  -- Upsert role
  INSERT INTO public.user_roles (id, user_id, organization_id, role)
  VALUES (gen_random_uuid()::text, p_user_id, v_my_org, p_role)
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, organization_id = EXCLUDED.organization_id;

  UPDATE public.user_roles SET role = p_role WHERE user_id = p_user_id AND organization_id = v_my_org;

  -- Update Team Membership
  IF p_team_id IS NOT NULL THEN
    -- Verify team belongs to this company
    IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = p_team_id AND organization_id = v_my_org) THEN
      RAISE EXCEPTION 'Invalid team specified for this company';
    END IF;

    DELETE FROM public.team_members WHERE user_id = p_user_id AND organization_id = v_my_org;
    INSERT INTO public.team_members (id, team_id, user_id, organization_id)
    VALUES (gen_random_uuid()::text, p_team_id, p_user_id, v_my_org)
    ON CONFLICT (team_id, user_id) DO NOTHING;
  END IF;

  -- Update Reporting Line
  IF p_manager_id IS NOT NULL THEN
    -- Verify manager belongs to this company
    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_manager_id AND organization_id = v_my_org) THEN
      RAISE EXCEPTION 'Manager must belong to the same company';
    END IF;

    DELETE FROM public.reporting_lines WHERE executive_id = p_user_id;
    INSERT INTO public.reporting_lines (id, organization_id, manager_id, executive_id)
    VALUES (gen_random_uuid()::text, v_my_org, p_manager_id, p_user_id)
    ON CONFLICT (manager_id, executive_id) DO NOTHING;
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

-- 7. COMPLETE TASK CREATION & MULTI-ASSIGNMENT RPC
CREATE OR REPLACE FUNCTION public.crm_create_task_with_assignments(
  p_title text,
  p_description text DEFAULT NULL,
  p_type text DEFAULT 'Call',
  p_priority text DEFAULT 'Medium',
  p_due_date text DEFAULT NULL,
  p_due_time text DEFAULT NULL,
  p_reminder_at text DEFAULT NULL,
  p_lead_id text DEFAULT NULL,
  p_team_id text DEFAULT NULL,
  p_assignment_mode text DEFAULT 'INDIVIDUAL',
  p_assignee_ids text[] DEFAULT '{}'::text[],
  p_repeat text DEFAULT 'Don''t Repeat',
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id text := public.crm_org();
  v_task_id text;
  v_due_timestamp timestamptz;
  v_assignee_id text;
  v_is_admin boolean;
  v_is_mgr boolean;
  v_is_super boolean := public.crm_is_super_admin();
BEGIN
  -- Title validation
  IF TRIM(p_title) = '' THEN
    RAISE EXCEPTION 'Task title is required';
  END IF;

  v_is_admin := public.crm_is_company_admin(v_org_id);
  v_is_mgr := public.crm_is_manager(v_org_id);

  -- Only Super Admin, Admin, and Manager can create and assign tasks
  IF NOT (v_is_super OR v_is_admin OR v_is_mgr) THEN
    RAISE EXCEPTION 'Unauthorized: Only Admins, Managers, and Super Admins can assign tasks';
  END IF;

  -- Parse due timestamp
  IF p_due_date IS NOT NULL AND TRIM(p_due_date) != '' THEN
    BEGIN
      v_due_timestamp := (p_due_date || ' ' || COALESCE(NULLIF(p_due_time, ''), '18:00:00'))::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_due_timestamp := now() + interval '1 day';
    END;
  ELSE
    v_due_timestamp := now() + interval '1 day';
  END IF;

  -- If Manager: verify all assignees are in manager's reporting line or team
  IF v_is_mgr AND NOT (v_is_admin OR v_is_super) THEN
    FOREACH v_assignee_id IN ARRAY p_assignee_ids LOOP
      IF v_assignee_id != auth.uid()::text AND NOT EXISTS (
        SELECT 1 FROM public.crm_managed_executive_ids() WHERE executive_id = v_assignee_id
      ) THEN
        RAISE EXCEPTION 'Managers can only assign tasks to executives in their reporting line or team (Violated by: %)', v_assignee_id;
      END IF;
    END LOOP;
  END IF;

  -- Create task row
  INSERT INTO public.tasks (
    id, organization_id, owner_id, lead_id, title, description,
    due_at, due_time, priority, status, completed,
    task_type, repeat, notes, team_id, assignment_mode,
    created_by, created_at
  ) VALUES (
    gen_random_uuid()::text, v_org_id, 
    COALESCE(p_assignee_ids[1], auth.uid()::text),
    p_lead_id, TRIM(p_title), p_description,
    v_due_timestamp, p_due_time, p_priority, 'Pending', 'f',
    p_type, p_repeat, p_notes, p_team_id, p_assignment_mode,
    auth.uid()::text, now()
  ) RETURNING id INTO v_task_id;

  -- Create individual task assignments
  IF p_assignment_mode = 'INDIVIDUAL' AND ARRAY_LENGTH(p_assignee_ids, 1) > 0 THEN
    FOREACH v_assignee_id IN ARRAY p_assignee_ids LOOP
      INSERT INTO public.task_assignments (
        id, task_id, organization_id, user_id, assigned_by, status, assigned_at
      ) VALUES (
        gen_random_uuid()::text, v_task_id, v_org_id, v_assignee_id, auth.uid()::text, 'Pending', now()
      ) ON CONFLICT (task_id, user_id) DO NOTHING;
    END LOOP;
  ELSIF p_assignment_mode = 'SHARED_TEAM' AND p_team_id IS NOT NULL THEN
    -- In shared team mode, populate assignments for all active team members
    INSERT INTO public.task_assignments (id, task_id, organization_id, user_id, assigned_by, status, assigned_at)
    SELECT gen_random_uuid()::text, v_task_id, v_org_id, tm.user_id, auth.uid()::text, 'Pending', now()
    FROM public.team_members tm
    WHERE tm.team_id = p_team_id
    ON CONFLICT (task_id, user_id) DO NOTHING;
  ELSE
    -- Default fallback assignment to creator
    INSERT INTO public.task_assignments (
      id, task_id, organization_id, user_id, assigned_by, status, assigned_at
    ) VALUES (
      gen_random_uuid()::text, v_task_id, v_org_id, auth.uid()::text, auth.uid()::text, 'Pending', now()
    ) ON CONFLICT DO NOTHING;
  END IF;

  -- Log action in task_activity_log
  INSERT INTO public.task_activity_log (task_id, organization_id, actor_id, action, details)
  VALUES (
    v_task_id, v_org_id, auth.uid()::text, 'CREATED',
    jsonb_build_object(
      'title', p_title,
      'type', p_type,
      'priority', p_priority,
      'due_at', v_due_timestamp,
      'assignment_mode', p_assignment_mode,
      'assignees', p_assignee_ids,
      'team_id', p_team_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'task_id', v_task_id,
    'title', p_title,
    'status', 'Pending'
  );
END;
$$;

-- 8. TASK STATUS UPDATE & COMPLETION REMARKS RPC
CREATE OR REPLACE FUNCTION public.crm_update_task_status_and_remarks(
  p_task_id text,
  p_status text,
  p_remarks text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_task RECORD;
  v_all_completed boolean;
BEGIN
  IF p_status NOT IN ('Pending', 'In Progress', 'Completed', 'Overdue') THEN
    RAISE EXCEPTION 'Invalid task status: %', p_status;
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- Update assignment status for current user
  UPDATE public.task_assignments
  SET 
    status = p_status,
    remarks = COALESCE(p_remarks, remarks),
    completed_at = CASE WHEN p_status = 'Completed' THEN now() ELSE NULL END
  WHERE task_id = p_task_id AND (user_id = auth.uid()::text OR public.crm_is_company_admin(v_task.organization_id));

  -- Check if all assignments are completed or if this was single/shared
  SELECT NOT EXISTS (
    SELECT 1 FROM public.task_assignments WHERE task_id = p_task_id AND status != 'Completed'
  ) INTO v_all_completed;

  IF p_status = 'Completed' OR v_all_completed THEN
    UPDATE public.tasks
    SET 
      status = 'Completed',
      completed = 't',
      completed_by = auth.uid()::text,
      completed_at = now()
    WHERE id = p_task_id;
  ELSE
    UPDATE public.tasks
    SET 
      status = p_status,
      completed = 'f'
    WHERE id = p_task_id;
  END IF;

  -- Log action in task_activity_log
  INSERT INTO public.task_activity_log (task_id, organization_id, actor_id, action, details)
  VALUES (
    p_task_id, v_task.organization_id, auth.uid()::text, 'STATUS_CHANGED',
    jsonb_build_object('status', p_status, 'remarks', p_remarks)
  );

  RETURN jsonb_build_object('success', true, 'task_id', p_task_id, 'status', p_status);
END;
$$;

-- 9. BULK REASSIGNMENT & DUE DATE CHANGE RPC
CREATE OR REPLACE FUNCTION public.crm_bulk_reassign_tasks(
  p_task_ids text[],
  p_new_assignee_id text DEFAULT NULL,
  p_new_due_date text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tid text;
  v_due_ts timestamptz;
  v_org_id text := public.crm_org();
BEGIN
  IF NOT (public.crm_is_company_admin(v_org_id) OR public.crm_is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized: Only Admins can perform bulk task actions';
  END IF;

  IF p_new_due_date IS NOT NULL AND TRIM(p_new_due_date) != '' THEN
    v_due_ts := p_new_due_date::timestamptz;
  END IF;

  FOREACH v_tid IN ARRAY p_task_ids LOOP
    IF v_due_ts IS NOT NULL THEN
      UPDATE public.tasks SET due_at = v_due_ts WHERE id = v_tid AND organization_id = v_org_id;
    END IF;

    IF p_new_assignee_id IS NOT NULL THEN
      UPDATE public.tasks SET owner_id = p_new_assignee_id WHERE id = v_tid AND organization_id = v_org_id;
      
      -- Replace or update assignment
      DELETE FROM public.task_assignments WHERE task_id = v_tid;
      INSERT INTO public.task_assignments (id, task_id, organization_id, user_id, assigned_by, status, assigned_at)
      VALUES (gen_random_uuid()::text, v_tid, v_org_id, p_new_assignee_id, auth.uid()::text, 'Pending', now())
      ON CONFLICT DO NOTHING;

      INSERT INTO public.task_activity_log (task_id, organization_id, actor_id, action, details)
      VALUES (
        v_tid, v_org_id, auth.uid()::text, 'REASSIGNED',
        jsonb_build_object('new_assignee_id', p_new_assignee_id, 'new_due_at', v_due_ts)
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'affected_count', ARRAY_LENGTH(p_task_ids, 1));
END;
$$;
