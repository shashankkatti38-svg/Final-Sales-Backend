-- ============================================================================
-- SALESWORKS360 CRM: MULTI-COMPANY SUPER ADMIN, ROLE HIERARCHY & TASK ASSIGNMENT
-- Migration: 20261026_multi_company_roles_tasks.sql
-- ============================================================================

-- 1. EXTEND UNDERLYING "Organization" TABLE & "organizations" VIEW
ALTER TABLE public."Organization" 
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Ensure constraint on status in "Organization"
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organization_status_check'
  ) THEN
    ALTER TABLE public."Organization"
      ADD CONSTRAINT organization_status_check 
      CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED'));
  END IF;
END $$;

-- Recreate organizations view with status and deleted_at
CREATE OR REPLACE VIEW public.organizations AS
SELECT id,
  owner_id,
  name,
  created_at,
  followup_enabled,
  followup_days,
  bank_details,
  invite_code,
  auto_assign,
  rr_cursor,
  recording_retention_days,
  shift_start,
  status,
  deleted_at
FROM public."Organization";

-- 2. CREATE TEAMS TABLE
CREATE TABLE IF NOT EXISTS public.teams (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  leader_id TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teams_org ON public.teams(organization_id);
CREATE INDEX IF NOT EXISTS idx_teams_leader ON public.teams(leader_id);

-- 3. CREATE TEAM_MEMBERS TABLE
CREATE TABLE IF NOT EXISTS public.team_members (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  team_id TEXT NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_team_member UNIQUE (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_user ON public.team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_org ON public.team_members(organization_id);

-- 4. CREATE REPORTING_LINES TABLE (Manager -> Executive)
CREATE TABLE IF NOT EXISTS public.reporting_lines (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  manager_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  executive_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_reporting_line UNIQUE (manager_id, executive_id)
);

CREATE INDEX IF NOT EXISTS idx_reporting_lines_manager ON public.reporting_lines(manager_id);
CREATE INDEX IF NOT EXISTS idx_reporting_lines_executive ON public.reporting_lines(executive_id);
CREATE INDEX IF NOT EXISTS idx_reporting_lines_org ON public.reporting_lines(organization_id);

-- 5. EXTEND TASKS TABLE WITH FULL FIELD SPECIFICATION
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS team_id TEXT REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS assignment_mode TEXT DEFAULT 'INDIVIDUAL',
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Pending',
  ADD COLUMN IF NOT EXISTS reminder_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS due_time TEXT,
  ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Sync legacy completed column with status
UPDATE public.tasks 
SET status = 'Completed', completed_at = COALESCE(completed_at, now())
WHERE completed = 't' AND (status IS NULL OR status = 'Pending');

UPDATE public.tasks 
SET status = 'Pending' 
WHERE (completed IS NULL OR completed = 'f') AND (status IS NULL);

-- Add check constraints for tasks
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_assignment_mode_check'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_assignment_mode_check 
      CHECK (assignment_mode IN ('SHARED_TEAM', 'INDIVIDUAL'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_status_check'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_status_check 
      CHECK (status IN ('Pending', 'In Progress', 'Completed', 'Overdue'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_team ON public.tasks(team_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON public.tasks(due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON public.tasks(created_by);

-- 6. CREATE TASK_ASSIGNMENTS TABLE (Individual assignments per employee)
CREATE TABLE IF NOT EXISTS public.task_assignments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  task_id TEXT NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'Pending',
  remarks TEXT,
  assigned_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT uq_task_user_assignment UNIQUE (task_id, user_id),
  CONSTRAINT task_assignment_status_check CHECK (status IN ('Pending', 'In Progress', 'Completed', 'Overdue'))
);

CREATE INDEX IF NOT EXISTS idx_task_assignments_user ON public.task_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_task_assignments_task ON public.task_assignments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_assignments_org ON public.task_assignments(organization_id);

-- 7. CREATE TASK_ACTIVITY_LOG TABLE (Immutable History & Audit Trail)
CREATE TABLE IF NOT EXISTS public.task_activity_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  task_id TEXT NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_activity_task ON public.task_activity_log(task_id);
CREATE INDEX IF NOT EXISTS idx_task_activity_org ON public.task_activity_log(organization_id);

-- 8. CREATE COMPANY_AUDIT_LOGS TABLE (Cross-company Super Admin & tenant security log)
CREATE TABLE IF NOT EXISTS public.company_audit_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  actor_id TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_organization_id TEXT REFERENCES public."Organization"(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_audit_actor ON public.company_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_company_audit_target_org ON public.company_audit_logs(target_organization_id);

-- 9. HELPER FUNCTIONS FOR SECURITY & ROLES

-- Check if current authenticated user is a platform-level Super Admin
CREATE OR REPLACE FUNCTION public.crm_is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()::text
      AND role = 'Super Admin'
  );
$$;

-- Check if current authenticated user is an Admin of their company (or Super Admin)
CREATE OR REPLACE FUNCTION public.crm_is_company_admin(target_org_id text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()::text
      AND (
        role = 'Super Admin'
        OR (
          role IN ('Organization Admin', 'Admin')
          AND (target_org_id IS NULL OR organization_id = target_org_id)
        )
      )
  );
$$;

-- Check if user is a Manager in an organization
CREATE OR REPLACE FUNCTION public.crm_is_manager(target_org_id text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()::text
      AND role IN ('Manager', 'Team Leader', 'Sales Manager')
      AND (target_org_id IS NULL OR organization_id = target_org_id)
  );
$$;

-- Check if user has Developer role
CREATE OR REPLACE FUNCTION public.crm_is_developer()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()::text
      AND role = 'Developer'
  );
$$;

-- Returns list of executive IDs reporting to the current user (if manager)
CREATE OR REPLACE FUNCTION public.crm_managed_executive_ids()
RETURNS TABLE (executive_id text)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT rl.executive_id
  FROM public.reporting_lines rl
  WHERE rl.manager_id = auth.uid()::text
  UNION
  SELECT tm.user_id
  FROM public.teams t
  JOIN public.team_members tm ON tm.team_id = t.id
  WHERE t.leader_id = auth.uid()::text;
$$;

-- Update crm_user_role to return highest role priority
CREATE OR REPLACE FUNCTION public.crm_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT role
  FROM public.user_roles
  WHERE user_id = auth.uid()::text
  ORDER BY CASE role
    WHEN 'Super Admin' THEN 1
    WHEN 'Organization Admin' THEN 2
    WHEN 'Admin' THEN 3
    WHEN 'Manager' THEN 4
    WHEN 'Sales Manager' THEN 5
    WHEN 'Team Leader' THEN 6
    WHEN 'Executive' THEN 7
    WHEN 'Sales Rep' THEN 8
    WHEN 'Developer' THEN 9
    ELSE 10
  END
  LIMIT 1;
$$;

-- 10. BOOTSTRAP SUPER ADMIN PROCEDURE
CREATE OR REPLACE FUNCTION public.crm_bootstrap_super_admin(target_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id text;
  v_org_id text;
BEGIN
  -- Look up real user id from auth.users by email
  SELECT id::text INTO v_user_id 
  FROM auth.users 
  WHERE email = LOWER(TRIM(target_email));

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No user found in auth.users with email: %', target_email;
  END IF;

  -- Get or assign to primary company
  SELECT id INTO v_org_id FROM public."Organization" ORDER BY created_at ASC LIMIT 1;
  IF v_org_id IS NULL THEN
    INSERT INTO public."Organization" (id, name, created_at, status)
    VALUES (gen_random_uuid()::text, 'SalesWorks360', now(), 'ACTIVE')
    RETURNING id INTO v_org_id;
  END IF;

  -- Ensure profile exists
  INSERT INTO public.profiles (id, display_name, created_at)
  VALUES (v_user_id, target_email, now())
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

  -- Upsert role to 'Super Admin'
  DELETE FROM public.user_roles WHERE user_id = v_user_id;
  INSERT INTO public.user_roles (id, user_id, organization_id, role)
  VALUES (gen_random_uuid()::text, v_user_id, v_org_id, 'Super Admin');

  -- Log action
  INSERT INTO public.company_audit_logs (actor_id, target_organization_id, action, details)
  VALUES (v_user_id, v_org_id, 'BOOTSTRAP_SUPER_ADMIN', jsonb_build_object('email', target_email));

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'email', target_email,
    'role', 'Super Admin',
    'organization_id', v_org_id
  );
END;
$$;

-- 11. ROW LEVEL SECURITY (RLS) POLICIES

-- Enable RLS on physical tables
ALTER TABLE public."Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reporting_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------
-- RLS POLICIES FOR "Organization" (COMPANIES)
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "org_super_admin_all" ON public."Organization";
CREATE POLICY "org_super_admin_all" ON public."Organization"
  FOR ALL TO authenticated
  USING (public.crm_is_super_admin())
  WITH CHECK (public.crm_is_super_admin());

DROP POLICY IF EXISTS "org_member_select" ON public."Organization";
CREATE POLICY "org_member_select" ON public."Organization"
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND id IN (SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()::text)
  );

DROP POLICY IF EXISTS "org_admin_update" ON public."Organization";
CREATE POLICY "org_admin_update" ON public."Organization"
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND public.crm_is_company_admin(id)
  )
  WITH CHECK (
    deleted_at IS NULL
    AND public.crm_is_company_admin(id)
  );

-- -------------------------------------------------------------
-- RLS POLICIES FOR TEAMS & TEAM_MEMBERS
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "teams_isolation" ON public.teams;
CREATE POLICY "teams_isolation" ON public.teams
  FOR ALL TO authenticated
  USING (
    public.crm_is_super_admin()
    OR organization_id = public.crm_org()
  )
  WITH CHECK (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (public.crm_is_company_admin(organization_id) OR leader_id = auth.uid()::text)
    )
  );

DROP POLICY IF EXISTS "team_members_isolation" ON public.team_members;
CREATE POLICY "team_members_isolation" ON public.team_members
  FOR ALL TO authenticated
  USING (
    public.crm_is_super_admin()
    OR organization_id = public.crm_org()
  )
  WITH CHECK (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND public.crm_is_company_admin(organization_id)
    )
  );

-- -------------------------------------------------------------
-- RLS POLICIES FOR REPORTING_LINES
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "reporting_lines_isolation" ON public.reporting_lines;
CREATE POLICY "reporting_lines_isolation" ON public.reporting_lines
  FOR ALL TO authenticated
  USING (
    public.crm_is_super_admin()
    OR organization_id = public.crm_org()
  )
  WITH CHECK (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND public.crm_is_company_admin(organization_id)
    )
  );

-- -------------------------------------------------------------
-- RLS POLICIES FOR TASKS (Hierarchical Visibility)
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "tasks_super_admin_all" ON public.tasks;
CREATE POLICY "tasks_super_admin_all" ON public.tasks
  FOR ALL TO authenticated
  USING (public.crm_is_super_admin())
  WITH CHECK (public.crm_is_super_admin());

DROP POLICY IF EXISTS "tasks_company_admin_all" ON public.tasks;
CREATE POLICY "tasks_company_admin_all" ON public.tasks
  FOR ALL TO authenticated
  USING (
    organization_id = public.crm_org()
    AND public.crm_is_company_admin(organization_id)
  )
  WITH CHECK (
    organization_id = public.crm_org()
    AND public.crm_is_company_admin(organization_id)
  );

DROP POLICY IF EXISTS "tasks_manager_select" ON public.tasks;
CREATE POLICY "tasks_manager_select" ON public.tasks
  FOR SELECT TO authenticated
  USING (
    organization_id = public.crm_org()
    AND public.crm_is_manager(organization_id)
    AND (
      owner_id = auth.uid()::text
      OR created_by = auth.uid()::text
      OR team_id IN (SELECT id FROM public.teams WHERE leader_id = auth.uid()::text)
      OR id IN (
        SELECT task_id FROM public.task_assignments 
        WHERE user_id = auth.uid()::text 
           OR user_id IN (SELECT executive_id FROM public.crm_managed_executive_ids())
      )
    )
  );

DROP POLICY IF EXISTS "tasks_manager_insert_update" ON public.tasks;
CREATE POLICY "tasks_manager_insert_update" ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.crm_org()
    AND public.crm_is_manager(organization_id)
  );

DROP POLICY IF EXISTS "tasks_manager_update" ON public.tasks;
CREATE POLICY "tasks_manager_update" ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.crm_org()
    AND public.crm_is_manager(organization_id)
    AND (
      owner_id = auth.uid()::text
      OR created_by = auth.uid()::text
      OR team_id IN (SELECT id FROM public.teams WHERE leader_id = auth.uid()::text)
      OR id IN (
        SELECT task_id FROM public.task_assignments 
        WHERE user_id = auth.uid()::text 
           OR user_id IN (SELECT executive_id FROM public.crm_managed_executive_ids())
      )
    )
  )
  WITH CHECK (
    organization_id = public.crm_org()
  );

DROP POLICY IF EXISTS "tasks_executive_select" ON public.tasks;
CREATE POLICY "tasks_executive_select" ON public.tasks
  FOR SELECT TO authenticated
  USING (
    organization_id = public.crm_org()
    AND (
      owner_id = auth.uid()::text
      OR id IN (SELECT task_id FROM public.task_assignments WHERE user_id = auth.uid()::text)
      OR (
        assignment_mode = 'SHARED_TEAM' 
        AND team_id IN (SELECT team_id FROM public.team_members WHERE user_id = auth.uid()::text)
      )
    )
  );

DROP POLICY IF EXISTS "tasks_executive_update" ON public.tasks;
CREATE POLICY "tasks_executive_update" ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.crm_org()
    AND (
      owner_id = auth.uid()::text
      OR id IN (SELECT task_id FROM public.task_assignments WHERE user_id = auth.uid()::text)
      OR (
        assignment_mode = 'SHARED_TEAM' 
        AND team_id IN (SELECT team_id FROM public.team_members WHERE user_id = auth.uid()::text)
      )
    )
  )
  WITH CHECK (
    organization_id = public.crm_org()
  );

-- -------------------------------------------------------------
-- RLS POLICIES FOR TASK_ASSIGNMENTS
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "task_assignments_access" ON public.task_assignments;
CREATE POLICY "task_assignments_access" ON public.task_assignments
  FOR ALL TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR user_id = auth.uid()::text
        OR assigned_by = auth.uid()::text
        OR user_id IN (SELECT executive_id FROM public.crm_managed_executive_ids())
      )
    )
  )
  WITH CHECK (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR assigned_by = auth.uid()::text
        OR user_id = auth.uid()::text
        OR user_id IN (SELECT executive_id FROM public.crm_managed_executive_ids())
      )
    )
  );

-- -------------------------------------------------------------
-- RLS POLICIES FOR TASK_ACTIVITY_LOG
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "task_activity_log_select" ON public.task_activity_log;
CREATE POLICY "task_activity_log_select" ON public.task_activity_log
  FOR SELECT TO authenticated
  USING (
    public.crm_is_super_admin()
    OR organization_id = public.crm_org()
  );

DROP POLICY IF EXISTS "task_activity_log_insert" ON public.task_activity_log;
CREATE POLICY "task_activity_log_insert" ON public.task_activity_log
  FOR INSERT TO authenticated
  WITH CHECK (
    public.crm_is_super_admin()
    OR organization_id = public.crm_org()
  );

-- -------------------------------------------------------------
-- RLS POLICIES FOR COMPANY_AUDIT_LOGS
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "company_audit_logs_select" ON public.company_audit_logs;
CREATE POLICY "company_audit_logs_select" ON public.company_audit_logs
  FOR SELECT TO authenticated
  USING (public.crm_is_super_admin());

DROP POLICY IF EXISTS "company_audit_logs_insert" ON public.company_audit_logs;
CREATE POLICY "company_audit_logs_insert" ON public.company_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- -------------------------------------------------------------
-- RLS RESTRICTION: DEVELOPERS MUST NOT ACCESS COMMERCIAL LEADS DATA
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "leads_select_policy" ON public.leads;
CREATE POLICY "leads_select_policy" ON public.leads
  FOR SELECT TO authenticated
  USING (
    -- Developer role has zero access to leads table
    NOT public.crm_is_developer()
    AND (
      public.crm_is_super_admin()
      OR (
        organization_id = public.crm_org()
        AND (
          public.crm_is_company_admin(organization_id)
          OR public.crm_is_manager(organization_id)
          OR owner_id = auth.uid()::text
          OR assigned_to = auth.uid()::text
          OR owner_id IS NULL
        )
      )
    )
  );

-- -------------------------------------------------------------
-- PREVENT USERS FROM ALTERING THEIR OWN ROLE OR ORGANIZATION_ID
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "user_roles_update_restrict" ON public.user_roles;
CREATE POLICY "user_roles_update_restrict" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND public.crm_is_company_admin(organization_id)
      AND role != 'Super Admin'
    )
  )
  WITH CHECK (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND public.crm_is_company_admin(organization_id)
      AND role != 'Super Admin'
    )
  );
