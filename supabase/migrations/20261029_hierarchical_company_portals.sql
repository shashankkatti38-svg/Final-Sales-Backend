-- Limit company portal records to each user's place in the reporting hierarchy.

CREATE OR REPLACE FUNCTION public.crm_can_view_member(target_user_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT target_user_id = auth.uid()::text
    OR public.crm_is_company_admin(public.crm_org())
    OR EXISTS (
      SELECT 1
      FROM public.reporting_lines rl
      JOIN public.user_roles viewer_role
        ON viewer_role.user_id = auth.uid()::text
       AND viewer_role.organization_id = rl.organization_id
      JOIN public.user_roles target_role
        ON target_role.user_id = rl.executive_id
       AND target_role.organization_id = rl.organization_id
      WHERE rl.organization_id = public.crm_org()
        AND rl.manager_id = auth.uid()::text
        AND rl.executive_id = target_user_id
        AND (
          (
            viewer_role.role IN ('Manager', 'Sales Manager', 'Team Leader')
            AND target_role.role IN ('Executive', 'Sales Executive', 'Sales Rep', 'Telecaller')
          )
          OR (
            viewer_role.role IN ('Executive', 'Sales Executive', 'Sales Rep', 'Telecaller')
            AND target_role.role = 'Developer'
          )
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.crm_can_view_task(target_task_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = target_task_id
      AND (
        public.crm_is_super_admin()
        OR t.organization_id = public.crm_org()
      )
      AND (
        public.crm_is_company_admin(t.organization_id)
        OR public.crm_can_view_member(t.owner_id)
        OR EXISTS (
          SELECT 1
          FROM public.task_assignments ta
          WHERE ta.task_id = t.id
            AND ta.organization_id = t.organization_id
            AND public.crm_can_view_member(ta.user_id)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.crm_can_view_lead(target_lead_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.id::text = target_lead_id
      AND (
        public.crm_is_super_admin()
        OR (
          l.organization_id = public.crm_org()
          AND NOT public.crm_is_developer()
          AND (
            public.crm_is_company_admin(l.organization_id)
            OR public.crm_can_view_member(COALESCE(l.assigned_to, l.owner_id)::text)
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.crm_can_view_member(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_can_view_task(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_can_view_lead(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_can_view_member(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_can_view_task(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_can_view_lead(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_validate_reporting_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  parent_role text;
  child_role text;
BEGIN
  SELECT role INTO parent_role
  FROM public.user_roles
  WHERE user_id = NEW.manager_id
    AND organization_id = NEW.organization_id;

  SELECT role INTO child_role
  FROM public.user_roles
  WHERE user_id = NEW.executive_id
    AND organization_id = NEW.organization_id;

  IF NOT (
    (parent_role IN ('Manager', 'Sales Manager', 'Team Leader')
      AND child_role IN ('Executive', 'Sales Executive', 'Sales Rep', 'Telecaller'))
    OR (parent_role IN ('Executive', 'Sales Executive', 'Sales Rep', 'Telecaller')
      AND child_role = 'Developer')
  ) THEN
    RAISE EXCEPTION 'Reporting lines must follow Manager to Executive to Developer';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reporting_line_role_hierarchy ON public.reporting_lines;
CREATE TRIGGER reporting_line_role_hierarchy
  BEFORE INSERT OR UPDATE ON public.reporting_lines
  FOR EACH ROW EXECUTE FUNCTION public.crm_validate_reporting_line();

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

  IF p_role NOT IN ('Admin', 'Organization Admin', 'Manager', 'Sales Manager', 'Team Leader', 'Executive', 'Sales Executive', 'Sales Rep', 'Telecaller', 'Developer', 'Super Admin') THEN
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

  IF (current_role = 'Super Admin' OR p_role = 'Super Admin')
    AND NOT public.crm_is_super_admin() THEN
    RAISE EXCEPTION 'Only Super Admins can manage Super Admin roles';
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

GRANT EXECUTE ON FUNCTION public.crm_company_admin_manage_member(text, text, text, text, text)
  TO authenticated, service_role;

-- Role and profile lookup must follow the same hierarchy as the portals.
DROP POLICY IF EXISTS team_profiles_read ON public.profiles;
CREATE POLICY role_scoped_profiles_read ON public.profiles
  FOR SELECT TO authenticated
  USING (public.crm_can_view_member(id::text));

DROP POLICY IF EXISTS admin_roles_read ON public.user_roles;
CREATE POLICY role_scoped_user_roles_read ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND public.crm_can_view_member(user_id::text)
    )
  );

DROP POLICY IF EXISTS reporting_lines_isolation ON public.reporting_lines;
DROP POLICY IF EXISTS reporting_lines_read_scope ON public.reporting_lines;
CREATE POLICY reporting_lines_read_scope ON public.reporting_lines
  FOR SELECT TO authenticated
  USING (
    public.crm_is_company_admin(organization_id)
    OR manager_id = auth.uid()::text
    OR executive_id = auth.uid()::text
  );
CREATE POLICY reporting_lines_admin_write ON public.reporting_lines
  FOR ALL TO authenticated
  USING (public.crm_is_company_admin(organization_id))
  WITH CHECK (public.crm_is_company_admin(organization_id));

DROP POLICY IF EXISTS team_members_isolation ON public.team_members;
CREATE POLICY team_members_role_scope ON public.team_members
  FOR SELECT TO authenticated
  USING (
    public.crm_is_company_admin(organization_id)
    OR user_id = auth.uid()::text
    OR public.crm_can_view_member(user_id)
  );
CREATE POLICY team_members_admin_write ON public.team_members
  FOR ALL TO authenticated
  USING (public.crm_is_company_admin(organization_id))
  WITH CHECK (public.crm_is_company_admin(organization_id));

-- Replace earlier permissive task policies with owner/report visibility.
DROP POLICY IF EXISTS own_tasks ON public.tasks;
DROP POLICY IF EXISTS tasks_super_admin_all ON public.tasks;
DROP POLICY IF EXISTS tasks_company_admin_all ON public.tasks;
DROP POLICY IF EXISTS tasks_manager_select ON public.tasks;
DROP POLICY IF EXISTS tasks_manager_insert_update ON public.tasks;
DROP POLICY IF EXISTS tasks_manager_update ON public.tasks;
DROP POLICY IF EXISTS tasks_executive_select ON public.tasks;
DROP POLICY IF EXISTS tasks_executive_update ON public.tasks;

CREATE POLICY hierarchical_tasks_select ON public.tasks
  FOR SELECT TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND public.crm_can_view_task(id)
    )
  );
CREATE POLICY hierarchical_tasks_insert ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR owner_id = auth.uid()::text
        OR public.crm_can_view_member(owner_id)
      )
      AND (
        lead_id IS NULL
        OR public.crm_can_view_lead(lead_id::text)
      )
    )
  );
CREATE POLICY hierarchical_tasks_update ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND public.crm_can_view_task(id)
    )
  )
  WITH CHECK (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR owner_id = auth.uid()::text
        OR public.crm_can_view_member(owner_id)
        OR EXISTS (
          SELECT 1
          FROM public.task_assignments ta
          WHERE ta.task_id = id
            AND ta.organization_id = organization_id
            AND ta.user_id = auth.uid()::text
        )
      )
      AND (
        lead_id IS NULL
        OR public.crm_can_view_lead(lead_id::text)
      )
    )
  );
CREATE POLICY hierarchical_tasks_delete ON public.tasks
  FOR DELETE TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR (
          NOT public.crm_is_developer()
          AND owner_id = auth.uid()::text
          AND (
            assigned_to IS NULL
            OR public.crm_can_view_member(assigned_to::text)
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS task_assignments_access ON public.task_assignments;
CREATE POLICY hierarchical_task_assignments_read ON public.task_assignments
  FOR SELECT TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR public.crm_can_view_member(user_id)
        OR assigned_by = auth.uid()::text
      )
    )
  );
CREATE POLICY hierarchical_task_assignments_write ON public.task_assignments
  FOR ALL TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR assigned_by = auth.uid()::text
      )
    )
  )
  WITH CHECK (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR (
          assigned_by = auth.uid()::text
          AND public.crm_can_view_member(user_id)
        )
      )
    )
  );

-- Leads and notes follow the record owner / direct-report scope.
DROP POLICY IF EXISTS own_leads ON public.leads;
DROP POLICY IF EXISTS assigned_leads_read ON public.leads;
DROP POLICY IF EXISTS assigned_leads_update ON public.leads;
DROP POLICY IF EXISTS leads_tenant_select ON public.leads;
DROP POLICY IF EXISTS leads_tenant_insert ON public.leads;
DROP POLICY IF EXISTS leads_tenant_update ON public.leads;
DROP POLICY IF EXISTS leads_tenant_delete ON public.leads;

CREATE POLICY hierarchical_leads_select ON public.leads
  FOR SELECT TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND NOT public.crm_is_developer()
      AND (
        public.crm_is_company_admin(organization_id)
        OR public.crm_can_view_member(COALESCE(assigned_to, owner_id)::text)
      )
    )
  );
CREATE POLICY hierarchical_leads_insert ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR (
          NOT public.crm_is_developer()
          AND owner_id = auth.uid()::text
          AND (
            assigned_to IS NULL
            OR public.crm_can_view_member(assigned_to::text)
          )
        )
      )
    )
  );
CREATE POLICY hierarchical_leads_update ON public.leads
  FOR UPDATE TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR public.crm_can_view_member(COALESCE(assigned_to, owner_id)::text)
      )
    )
  )
  WITH CHECK (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR owner_id = auth.uid()::text
        OR public.crm_can_view_member(COALESCE(assigned_to, owner_id)::text)
      )
    )
  );
CREATE POLICY hierarchical_leads_delete ON public.leads
  FOR DELETE TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND public.crm_is_company_admin(organization_id)
    )
  );

DROP POLICY IF EXISTS own_activities ON public.activities;
DROP POLICY IF EXISTS assigned_activities ON public.activities;
CREATE POLICY hierarchical_activities_select ON public.activities
  FOR SELECT TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR public.crm_can_view_member(owner_id::text)
      )
    )
  );
CREATE POLICY hierarchical_activities_insert ON public.activities
  FOR INSERT TO authenticated
  WITH CHECK (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR (
          owner_id = auth.uid()::text
          AND public.crm_can_view_lead(lead_id::text)
        )
      )
    )
  );
CREATE POLICY hierarchical_activities_update ON public.activities
  FOR UPDATE TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR (
          owner_id = auth.uid()::text
          AND public.crm_can_view_lead(lead_id::text)
        )
      )
    )
  )
  WITH CHECK (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR (
          owner_id = auth.uid()::text
          AND public.crm_can_view_lead(lead_id::text)
        )
      )
    )
  );
CREATE POLICY hierarchical_activities_delete ON public.activities
  FOR DELETE TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR (
          owner_id = auth.uid()::text
          AND public.crm_can_view_lead(lead_id::text)
        )
      )
    )
  );

-- Financial and field records are also limited to the owner/reporting chain.
DROP POLICY IF EXISTS own_documents ON public.sales_documents;
DROP POLICY IF EXISTS sales_documents_tenant_isolation ON public.sales_documents;
CREATE POLICY hierarchical_sales_documents_select ON public.sales_documents
  FOR SELECT TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR public.crm_can_view_member(owner_id::text)
      )
    )
  );
CREATE POLICY hierarchical_sales_documents_insert ON public.sales_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR (
          owner_id = auth.uid()::text
          AND public.crm_can_view_lead(lead_id::text)
        )
      )
    )
  );
CREATE POLICY hierarchical_sales_documents_update ON public.sales_documents
  FOR UPDATE TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR (
          owner_id = auth.uid()::text
          AND public.crm_can_view_lead(lead_id::text)
        )
      )
    )
  )
  WITH CHECK (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR (
          owner_id = auth.uid()::text
          AND public.crm_can_view_lead(lead_id::text)
        )
      )
    )
  );
CREATE POLICY hierarchical_sales_documents_delete ON public.sales_documents
  FOR DELETE TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (public.crm_is_company_admin(organization_id) OR owner_id = auth.uid()::text)
    )
  );

DROP POLICY IF EXISTS own_payment_read ON public.payments;
DROP POLICY IF EXISTS own_payment_insert ON public.payments;
DROP POLICY IF EXISTS payments_tenant_isolation ON public.payments;
CREATE POLICY hierarchical_payments_select ON public.payments
  FOR SELECT TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR public.crm_can_view_member(owner_id::text)
      )
    )
  );
CREATE POLICY hierarchical_payments_insert ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR owner_id = auth.uid()::text
      )
    )
  );
CREATE POLICY hierarchical_payments_update ON public.payments
  FOR UPDATE TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (public.crm_is_company_admin(organization_id) OR owner_id = auth.uid()::text)
    )
  )
  WITH CHECK (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (public.crm_is_company_admin(organization_id) OR owner_id = auth.uid()::text)
    )
  );
CREATE POLICY hierarchical_payments_delete ON public.payments
  FOR DELETE TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (public.crm_is_company_admin(organization_id) OR owner_id = auth.uid()::text)
    )
  );

DROP POLICY IF EXISTS own_checkins ON public.location_checkins;
DROP POLICY IF EXISTS location_checkins_tenant_isolation ON public.location_checkins;
CREATE POLICY hierarchical_checkins_select ON public.location_checkins
  FOR SELECT TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR public.crm_can_view_member(owner_id::text)
      )
    )
  );
CREATE POLICY hierarchical_checkins_insert ON public.location_checkins
  FOR INSERT TO authenticated
  WITH CHECK (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR (
          owner_id = auth.uid()::text
          AND (lead_id IS NULL OR public.crm_can_view_lead(lead_id::text))
        )
      )
    )
  );
CREATE POLICY hierarchical_checkins_update ON public.location_checkins
  FOR UPDATE TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR (
          owner_id = auth.uid()::text
          AND (lead_id IS NULL OR public.crm_can_view_lead(lead_id::text))
        )
      )
    )
  )
  WITH CHECK (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR (
          owner_id = auth.uid()::text
          AND (lead_id IS NULL OR public.crm_can_view_lead(lead_id::text))
        )
      )
    )
  );
CREATE POLICY hierarchical_checkins_delete ON public.location_checkins
  FOR DELETE TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (public.crm_is_company_admin(organization_id) OR owner_id = auth.uid()::text)
    )
  );

DROP POLICY IF EXISTS own_call_logs ON public.call_logs;
DROP POLICY IF EXISTS call_logs_tenant_isolation ON public.call_logs;
CREATE POLICY hierarchical_call_logs_select ON public.call_logs
  FOR SELECT TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR public.crm_can_view_member(owner_id::text)
      )
    )
  );
CREATE POLICY hierarchical_call_logs_insert ON public.call_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR (
          owner_id = auth.uid()::text
          AND public.crm_can_view_lead(lead_id::text)
        )
      )
    )
  );
CREATE POLICY hierarchical_call_logs_update ON public.call_logs
  FOR UPDATE TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR (
          owner_id = auth.uid()::text
          AND public.crm_can_view_lead(lead_id::text)
        )
      )
    )
  )
  WITH CHECK (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR (
          owner_id = auth.uid()::text
          AND public.crm_can_view_lead(lead_id::text)
        )
      )
    )
  );

-- Private developer attachments: the first path segment is the owning user ID.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('developer-files', 'developer-files', false, 10485760)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760;

DROP POLICY IF EXISTS developer_files_select ON storage.objects;
DROP POLICY IF EXISTS developer_files_insert ON storage.objects;
DROP POLICY IF EXISTS developer_files_update ON storage.objects;
DROP POLICY IF EXISTS developer_files_delete ON storage.objects;
CREATE POLICY developer_files_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'developer-files'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.crm_can_view_member((storage.foldername(name))[1])
    )
  );
CREATE POLICY developer_files_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'developer-files'
    AND public.crm_is_developer()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY developer_files_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'developer-files'
    AND public.crm_is_developer()
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'developer-files'
    AND public.crm_is_developer()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY developer_files_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'developer-files'
    AND public.crm_is_developer()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
