BEGIN;

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
          AND (
            public.crm_is_company_admin(l.organization_id)
            OR (
              public.crm_is_developer()
              AND l.assigned_to = auth.uid()::text
            )
            OR (
              NOT public.crm_is_developer()
              AND public.crm_can_view_member(COALESCE(l.assigned_to, l.owner_id)::text)
            )
            OR (
              public.crm_is_manager(l.organization_id)
              AND l.assigned_to IS NULL
            )
          )
        )
      )
  );
$$;

DROP POLICY IF EXISTS hierarchical_leads_select ON public.leads;
CREATE POLICY hierarchical_leads_select ON public.leads
  FOR SELECT TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR (
          public.crm_is_manager(organization_id)
          AND assigned_to IS NULL
        )
        OR (
          public.crm_is_developer()
          AND assigned_to = auth.uid()::text
        )
        OR (
          NOT public.crm_is_developer()
          AND public.crm_can_view_member(COALESCE(assigned_to, owner_id)::text)
        )
      )
    )
  );

DROP POLICY IF EXISTS hierarchical_leads_update ON public.leads;
CREATE POLICY hierarchical_leads_update ON public.leads
  FOR UPDATE TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR (
          public.crm_is_manager(organization_id)
          AND assigned_to IS NULL
        )
        OR (
          public.crm_is_developer()
          AND assigned_to = auth.uid()::text
        )
        OR (
          NOT public.crm_is_developer()
          AND public.crm_can_view_member(COALESCE(assigned_to, owner_id)::text)
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
          public.crm_is_developer()
          AND assigned_to = auth.uid()::text
        )
        OR (
          NOT public.crm_is_developer()
          AND (
            owner_id = auth.uid()::text
            OR public.crm_can_view_member(COALESCE(assigned_to, owner_id)::text)
            OR (
              public.crm_is_manager(organization_id)
              AND assigned_to IS NULL
            )
          )
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION public.crm_admin_assign_manager_reports(
  p_org_id text,
  p_manager_id text,
  p_member_ids text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  target_org text := COALESCE(NULLIF(p_org_id, ''), public.crm_org());
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in first';
  END IF;

  IF NOT (
    public.crm_is_super_admin()
    OR public.crm_is_company_admin(target_org)
  ) THEN
    RAISE EXCEPTION 'Only company admins can assign reporting teams';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles manager_role
    WHERE manager_role.user_id = p_manager_id
      AND manager_role.organization_id = target_org
      AND manager_role.role IN ('Manager', 'Sales Manager', 'Team Leader')
  ) THEN
    RAISE EXCEPTION 'Select a manager in this company';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_member_ids, ARRAY[]::text[])) selected(user_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.user_roles member_role
      WHERE member_role.user_id = selected.user_id
        AND member_role.organization_id = target_org
        AND member_role.role IN (
          'Executive',
          'Sales Executive',
          'Sales Executive 1',
          'Sales Executive 2',
          'Sales Executive 3',
          'Sales Rep',
          'Telecaller',
          'Developer'
        )
    )
  ) THEN
    RAISE EXCEPTION 'All selected members must be executives or developers in this company';
  END IF;

  DELETE FROM public.reporting_lines line
  USING public.user_roles member_role
  WHERE line.organization_id = target_org
    AND line.manager_id = p_manager_id
    AND member_role.user_id = line.executive_id
    AND member_role.organization_id = target_org
    AND member_role.role IN (
      'Executive',
      'Sales Executive',
      'Sales Executive 1',
      'Sales Executive 2',
      'Sales Executive 3',
      'Sales Rep',
      'Telecaller',
      'Developer'
    );

  DELETE FROM public.reporting_lines
  WHERE organization_id = target_org
    AND executive_id = ANY(COALESCE(p_member_ids, ARRAY[]::text[]));

  INSERT INTO public.reporting_lines (id, organization_id, manager_id, executive_id)
  SELECT gen_random_uuid()::text, target_org, p_manager_id, selected.user_id
  FROM (
    SELECT DISTINCT user_id
    FROM unnest(COALESCE(p_member_ids, ARRAY[]::text[])) selected(user_id)
  ) selected;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_admin_assign_manager_reports(text, text, text[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_assign_manager_reports(text, text, text[])
  TO authenticated, service_role;

COMMIT;
