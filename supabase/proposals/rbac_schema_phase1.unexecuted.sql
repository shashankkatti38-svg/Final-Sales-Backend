-- LOCAL-ONLY RBAC schema proposal.
-- DO NOT EXECUTE. This file is not a Supabase migration and is not included in
-- supabase/migrations/. It has not been validated against a staging database.
--
-- This proposal is additive: it preserves public.user_roles.role and all
-- existing CRM identifiers and status values. Existing role assignments are
-- not backfilled to role_definition_id or marked primary.
-- It does not alter Organization.status, leads.status, tasks.status,
-- leads.owner_id/assigned_to, tasks ownership, or task_assignments. Existing
-- teams, team_members, and reporting_lines remain the CRM relationship source.
--
-- Prerequisites to any future migration:
--   * Confirm the target database schema and migration authority.
--   * Verify the exact deployed definitions of public.profiles,
--     public."Organization", and public.user_roles.
--   * Inventory all user_roles values and resolve any role names not in the
--     requested compatibility list.
--   * Explicitly assign one primary role for each user/organization.
--   * Approve the role-permission matrix and backend/RLS enforcement.
--
-- The request says there are 15 existing role identities, but enumerates 14.
-- This proposal seeds only the 14 explicitly listed values; it does not invent
-- a fifteenth role.
--
-- Project and project-task tables are intentionally excluded pending separate
-- schema review and approval. CRM tasks remain separate from project tasks.
--
-- New RBAC tables enable RLS without client policies. They therefore deny
-- direct client access until separately reviewed policies and grants exist.

CREATE TYPE public.rbac_data_scope AS ENUM (
  'PLATFORM',
  'ORGANIZATION',
  'TEAM',
  'REPORTING_TREE',
  'ASSIGNED',
  'PROJECT_MEMBER',
  'OWN',
  'NONE'
);

CREATE TYPE public.rbac_account_status AS ENUM (
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
  'INVITED',
  'PENDING_VERIFICATION'
);

CREATE TABLE public.rbac_role_definitions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  role_key text NOT NULL UNIQUE
    CHECK (role_key ~ '^[A-Z][A-Z0-9_]*$'),
  legacy_role_name text NOT NULL UNIQUE
    CHECK (char_length(btrim(legacy_role_name)) BETWEEN 1 AND 100),
  is_platform_role boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rbac_role_definitions_id_legacy_name_unique
    UNIQUE (id, legacy_role_name)
);

INSERT INTO public.rbac_role_definitions (role_key, legacy_role_name, is_platform_role)
VALUES
  ('SUPER_ADMIN', 'Super Admin', true),
  ('ADMIN', 'Admin', false),
  ('ORGANIZATION_ADMIN', 'Organization Admin', false),
  ('MANAGER', 'Manager', false),
  ('SALES_MANAGER', 'Sales Manager', false),
  ('TEAM_LEADER', 'Team Leader', false),
  ('EXECUTIVE', 'Executive', false),
  ('SALES_REP', 'Sales Rep', false),
  ('SALES_EXECUTIVE', 'Sales Executive', false),
  ('SALES_EXECUTIVE_1', 'Sales Executive 1', false),
  ('SALES_EXECUTIVE_2', 'Sales Executive 2', false),
  ('SALES_EXECUTIVE_3', 'Sales Executive 3', false),
  ('TELECALLER', 'Telecaller', false),
  ('DEVELOPER', 'Developer', false)
ON CONFLICT (role_key) DO NOTHING;

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM public.rbac_role_definitions
    WHERE (role_key, legacy_role_name) IN (
      ('SUPER_ADMIN', 'Super Admin'),
      ('ADMIN', 'Admin'),
      ('ORGANIZATION_ADMIN', 'Organization Admin'),
      ('MANAGER', 'Manager'),
      ('SALES_MANAGER', 'Sales Manager'),
      ('TEAM_LEADER', 'Team Leader'),
      ('EXECUTIVE', 'Executive'),
      ('SALES_REP', 'Sales Rep'),
      ('SALES_EXECUTIVE', 'Sales Executive'),
      ('SALES_EXECUTIVE_1', 'Sales Executive 1'),
      ('SALES_EXECUTIVE_2', 'Sales Executive 2'),
      ('SALES_EXECUTIVE_3', 'Sales Executive 3'),
      ('TELECALLER', 'Telecaller'),
      ('DEVELOPER', 'Developer')
    )
  ) <> 14 THEN
    RAISE EXCEPTION
      'RBAC role catalog contains a conflicting key/name mapping; review before migration';
  END IF;
END;
$$;

CREATE TABLE public.rbac_permission_definitions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  permission_key text NOT NULL UNIQUE
    CHECK (permission_key ~ '^[a-z][a-z0-9_.-]*$'),
  category text NOT NULL
    CHECK (char_length(btrim(category)) BETWEEN 1 AND 80),
  resource text NOT NULL
    CHECK (char_length(btrim(resource)) BETWEEN 1 AND 80),
  action text NOT NULL
    CHECK (char_length(btrim(action)) BETWEEN 1 AND 80),
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rbac_permission_category_resource_action_unique
    UNIQUE (category, resource, action)
);

CREATE TABLE public.rbac_role_permissions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  role_definition_id text NOT NULL
    REFERENCES public.rbac_role_definitions(id) ON DELETE RESTRICT,
  permission_definition_id text NOT NULL
    REFERENCES public.rbac_permission_definitions(id) ON DELETE RESTRICT,
  data_scope public.rbac_data_scope NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT rbac_role_permissions_unique
    UNIQUE (role_definition_id, permission_definition_id, data_scope)
);

CREATE INDEX rbac_role_permissions_permission_idx
  ON public.rbac_role_permissions (permission_definition_id, role_definition_id);

ALTER TABLE public.user_roles
  ADD COLUMN role_definition_id text,
  ADD COLUMN is_primary boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT user_roles_role_definition_legacy_role_fkey
    FOREIGN KEY (role_definition_id, role)
    REFERENCES public.rbac_role_definitions (id, legacy_role_name)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  ADD CONSTRAINT user_roles_role_definition_requires_role_check
    CHECK (role_definition_id IS NULL OR role IS NOT NULL),
  ADD CONSTRAINT user_roles_primary_requires_organization_and_definition_check
    CHECK (
      NOT is_primary
      OR (organization_id IS NOT NULL AND role_definition_id IS NOT NULL)
    );

CREATE UNIQUE INDEX user_roles_one_primary_per_organization_idx
  ON public.user_roles (user_id, organization_id)
  WHERE is_primary AND user_id IS NOT NULL AND organization_id IS NOT NULL;

CREATE TABLE public.rbac_user_account_status (
  user_id text PRIMARY KEY
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  status public.rbac_account_status NOT NULL,
  reason text,
  changed_by text REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rbac_user_account_status_status_idx
  ON public.rbac_user_account_status (status, changed_at);

CREATE TABLE public.rbac_audit_log (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id text,
  actor_user_id text,
  subject_user_id text,
  role_definition_id text,
  permission_definition_id text,
  event_name text NOT NULL
    CHECK (char_length(btrim(event_name)) BETWEEN 1 AND 120),
  before_values jsonb,
  after_values jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rbac_audit_log_organization_time_idx
  ON public.rbac_audit_log (organization_id, occurred_at DESC);
CREATE INDEX rbac_audit_log_subject_time_idx
  ON public.rbac_audit_log (subject_user_id, occurred_at DESC);
CREATE INDEX rbac_audit_log_actor_time_idx
  ON public.rbac_audit_log (actor_user_id, occurred_at DESC);
CREATE INDEX rbac_audit_log_event_time_idx
  ON public.rbac_audit_log (event_name, occurred_at DESC);

CREATE FUNCTION public.rbac_capture_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  old_row jsonb;
  new_row jsonb;
  actor_id text;
  target_user_id text;
  target_organization_id text;
  target_role_id text;
  target_permission_id text;
  event_name text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_row := to_jsonb(OLD);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_row := to_jsonb(NEW);
  END IF;

  actor_id := auth.uid()::text;

  IF TG_TABLE_NAME = 'user_roles' THEN
    target_user_id := COALESCE(new_row->>'user_id', old_row->>'user_id');
    target_organization_id :=
      COALESCE(new_row->>'organization_id', old_row->>'organization_id');
    target_role_id :=
      COALESCE(new_row->>'role_definition_id', old_row->>'role_definition_id');
    event_name := CASE TG_OP
      WHEN 'INSERT' THEN 'USER_ROLE_ASSIGNED'
      WHEN 'UPDATE' THEN 'USER_ROLE_CHANGED'
      ELSE 'USER_ROLE_REMOVED'
    END;
  ELSIF TG_TABLE_NAME = 'rbac_role_definitions' THEN
    target_role_id := COALESCE(new_row->>'id', old_row->>'id');
    event_name := CASE TG_OP
      WHEN 'INSERT' THEN 'ROLE_DEFINITION_CREATED'
      WHEN 'UPDATE' THEN 'ROLE_DEFINITION_CHANGED'
      ELSE 'ROLE_DEFINITION_REMOVED'
    END;
  ELSIF TG_TABLE_NAME = 'rbac_permission_definitions' THEN
    target_permission_id := COALESCE(new_row->>'id', old_row->>'id');
    event_name := CASE TG_OP
      WHEN 'INSERT' THEN 'PERMISSION_DEFINITION_CREATED'
      WHEN 'UPDATE' THEN 'PERMISSION_DEFINITION_CHANGED'
      ELSE 'PERMISSION_DEFINITION_REMOVED'
    END;
  ELSIF TG_TABLE_NAME = 'rbac_role_permissions' THEN
    target_role_id :=
      COALESCE(new_row->>'role_definition_id', old_row->>'role_definition_id');
    target_permission_id :=
      COALESCE(
        new_row->>'permission_definition_id',
        old_row->>'permission_definition_id'
      );
    event_name := CASE TG_OP
      WHEN 'INSERT' THEN 'ROLE_PERMISSION_GRANTED'
      WHEN 'UPDATE' THEN 'ROLE_PERMISSION_CHANGED'
      ELSE 'ROLE_PERMISSION_REVOKED'
    END;
  ELSIF TG_TABLE_NAME = 'rbac_user_account_status' THEN
    target_user_id := COALESCE(new_row->>'user_id', old_row->>'user_id');
    event_name := CASE TG_OP
      WHEN 'INSERT' THEN 'USER_STATUS_CREATED'
      WHEN 'UPDATE' THEN 'USER_STATUS_CHANGED'
      ELSE 'USER_STATUS_REMOVED'
    END;
  ELSE
    RAISE EXCEPTION 'Unsupported RBAC audit trigger table: %', TG_TABLE_NAME;
  END IF;

  INSERT INTO public.rbac_audit_log (
    organization_id,
    actor_user_id,
    subject_user_id,
    role_definition_id,
    permission_definition_id,
    event_name,
    before_values,
    after_values
  )
  VALUES (
    target_organization_id,
    actor_id,
    target_user_id,
    target_role_id,
    target_permission_id,
    event_name,
    old_row,
    new_row
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER rbac_user_roles_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.rbac_capture_change();

CREATE TRIGGER rbac_role_definitions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.rbac_role_definitions
  FOR EACH ROW EXECUTE FUNCTION public.rbac_capture_change();

CREATE TRIGGER rbac_permission_definitions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.rbac_permission_definitions
  FOR EACH ROW EXECUTE FUNCTION public.rbac_capture_change();

CREATE TRIGGER rbac_role_permissions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.rbac_role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.rbac_capture_change();

CREATE TRIGGER rbac_user_account_status_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.rbac_user_account_status
  FOR EACH ROW EXECUTE FUNCTION public.rbac_capture_change();

CREATE FUNCTION public.rbac_reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'RBAC audit history is append-only';
END;
$$;

CREATE TRIGGER rbac_audit_log_append_only
  BEFORE UPDATE OR DELETE ON public.rbac_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.rbac_reject_audit_mutation();

ALTER TABLE public.rbac_role_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rbac_permission_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rbac_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rbac_user_account_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rbac_audit_log ENABLE ROW LEVEL SECURITY;
