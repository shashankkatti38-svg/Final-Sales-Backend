-- Local-only proposal for reporting-manager choices in the Team member dialog.
-- Do not apply until the database change has been separately approved.
-- Kept outside supabase/migrations so normal migration runs cannot pick it up.

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
            AND target_role.role IN (
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
          OR (
            viewer_role.role IN (
              'Executive',
              'Sales Executive',
              'Sales Executive 1',
              'Sales Executive 2',
              'Sales Executive 3',
              'Sales Rep',
              'Telecaller'
            )
            AND target_role.role = 'Developer'
          )
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.crm_validate_reporting_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  parent_role text;
  child_role text;
  is_authenticated_super_admin_parent boolean;
BEGIN
  SELECT role INTO parent_role
  FROM public.user_roles
  WHERE user_id = NEW.manager_id
    AND organization_id = NEW.organization_id;

  SELECT role INTO child_role
  FROM public.user_roles
  WHERE user_id = NEW.executive_id
    AND organization_id = NEW.organization_id;

  is_authenticated_super_admin_parent :=
    NEW.manager_id = auth.uid()::text
    AND public.crm_is_super_admin();

  IF NOT (
    (
      parent_role IN ('Manager', 'Sales Manager', 'Team Leader')
      AND child_role IN (
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
    OR (
      parent_role IN (
        'Executive',
        'Sales Executive',
        'Sales Executive 1',
        'Sales Executive 2',
        'Sales Executive 3',
        'Sales Rep',
        'Telecaller'
      )
      AND child_role = 'Developer'
    )
    OR (
      (parent_role = 'Super Admin' OR is_authenticated_super_admin_parent)
      AND child_role IN ('Manager', 'Developer')
    )
  ) THEN
    RAISE EXCEPTION 'Reporting line is not permitted for these roles';
  END IF;

  RETURN NEW;
END;
$$;

-- This proposal changes no tables, existing records, RLS policies, or users.
-- Rollback: restore crm_can_view_member and crm_validate_reporting_line from
-- 20261029_hierarchical_company_portals.sql, then recreate the
-- reporting_line_role_hierarchy trigger if it has been changed separately.
