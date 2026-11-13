BEGIN;

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
              'Executive', 'Sales Executive', 'Sales Rep', 'Telecaller', 'Developer'
            )
          )
          OR (
            viewer_role.role IN ('Executive', 'Sales Executive', 'Sales Rep', 'Telecaller')
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
    (
      parent_role IN ('Manager', 'Sales Manager', 'Team Leader')
      AND child_role IN (
        'Executive', 'Sales Executive', 'Sales Rep', 'Telecaller', 'Developer'
      )
    )
    OR (
      parent_role IN ('Executive', 'Sales Executive', 'Sales Rep', 'Telecaller')
      AND child_role = 'Developer'
    )
  ) THEN
    RAISE EXCEPTION 'Reporting lines must follow Manager to Executive to Developer';
  END IF;

  RETURN NEW;
END;
$$;

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
      (
        parent_role IN ('Manager', 'Sales Manager', 'Team Leader')
        AND p_role IN (
          'Executive', 'Sales Executive', 'Sales Rep', 'Telecaller', 'Developer'
        )
      )
      OR (
        parent_role IN ('Executive', 'Sales Executive', 'Sales Rep', 'Telecaller')
        AND p_role = 'Developer'
      )
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

CREATE TEMP TABLE manager_developer_targets (
  display_name text PRIMARY KEY,
  user_id text
) ON COMMIT DROP;

INSERT INTO manager_developer_targets (display_name)
VALUES
  ('Saurabh Sharma'),
  ('Manminder Singh'),
  ('Aniket Shukla'),
  ('Priya Pujar'),
  ('Sufiyan Ali'),
  ('Dhanush A'),
  ('Fredoson T'),
  ('Yallanagouda Hulyal'),
  ('Laxmi Biradar'),
  ('Hembabu Chappa'),
  ('Shashank Katti');

DO $$
DECLARE
  manager_user_id text;
  manager_org_id text;
  match_count integer;
  unresolved_names text;
  duplicate_relation boolean;
  target record;
  developer_user_id text;
BEGIN
  SELECT COUNT(*)
  INTO match_count
  FROM (
    SELECT DISTINCT ur.user_id, ur.organization_id
    FROM public.user_roles ur
    JOIN auth.users au ON au.id::text = ur.user_id
    WHERE LOWER(BTRIM(au.email)) = 'vicky.das@primepro.ai'
      AND LOWER(BTRIM(ur.role)) IN ('manager', 'sales manager', 'team leader')
  ) manager_matches;

  IF match_count <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one Manager account for vicky.das@primepro.ai; found %',
      match_count;
  END IF;

  SELECT ur.user_id, ur.organization_id
  INTO manager_user_id, manager_org_id
  FROM public.user_roles ur
  JOIN auth.users au ON au.id::text = ur.user_id
  WHERE LOWER(BTRIM(au.email)) = 'vicky.das@primepro.ai'
    AND LOWER(BTRIM(ur.role)) IN ('manager', 'sales manager', 'team leader')
  LIMIT 1;

  FOR target IN
    SELECT display_name FROM manager_developer_targets
  LOOP
    SELECT COUNT(DISTINCT ur.user_id)
    INTO match_count
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id::text = ur.user_id
    WHERE ur.organization_id = manager_org_id
      AND LOWER(BTRIM(ur.role)) = 'developer'
      AND LOWER(BTRIM(p.display_name)) = LOWER(BTRIM(target.display_name));

    IF match_count = 1 THEN
      SELECT MIN(ur.user_id)
      INTO developer_user_id
      FROM public.user_roles ur
      JOIN public.profiles p ON p.id::text = ur.user_id
      WHERE ur.organization_id = manager_org_id
        AND LOWER(BTRIM(ur.role)) = 'developer'
        AND LOWER(BTRIM(p.display_name)) = LOWER(BTRIM(target.display_name));

      UPDATE manager_developer_targets
      SET user_id = developer_user_id
      WHERE display_name = target.display_name;
    END IF;
  END LOOP;

  SELECT STRING_AGG(display_name, ', ' ORDER BY display_name)
  INTO unresolved_names
  FROM manager_developer_targets
  WHERE user_id IS NULL;

  IF unresolved_names IS NOT NULL THEN
    RAISE EXCEPTION
      'Missing or ambiguous Developer account(s) in Vicky''s organization: %',
      unresolved_names;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.reporting_lines rl
    JOIN manager_developer_targets target ON target.user_id = rl.executive_id
    WHERE rl.manager_id = manager_user_id
      AND rl.organization_id <> manager_org_id
  )
  INTO duplicate_relation;

  IF duplicate_relation THEN
    RAISE EXCEPTION
      'A target Developer already has the same Manager relationship in another organization';
  END IF;

  DELETE FROM public.reporting_lines rl
  USING manager_developer_targets target
  WHERE rl.executive_id = target.user_id
    AND rl.organization_id = manager_org_id;

  INSERT INTO public.reporting_lines (
    id, organization_id, manager_id, executive_id
  )
  SELECT
    gen_random_uuid()::text,
    manager_org_id,
    manager_user_id,
    target.user_id
  FROM manager_developer_targets target;
END;
$$;

COMMIT;
