-- REVIEW DRAFT ONLY: isolated PrimePro project management tables.
-- This file has NOT been executed. It is not production-ready or database-validated.
--
-- Scope:
--   * Adds project-specific records separate from CRM follow-up public.tasks.
--   * Reuses public."Organization", public.profiles, public.user_roles,
--     public.reporting_lines, and the existing crm_* authorization helpers.
--   * Adds recipient-scoped project notifications and append-only project audit.
--   * Does not alter existing CRM tables, policies, or records.
--
-- Before any execution:
--   1. Validate deployed table/function definitions in an isolated Supabase project.
--   2. Add authorization tests for Admin, Manager, Executive, Developer, and
--      cross-organization users; verify direct PostgREST access.
--   3. Separately approve auth hooks, file storage, due-date scheduling, and
--      existing RPC/policy changes not included in this proposal.
--
-- Rollback before this schema has been used: drop the primepro_* policies,
-- triggers, functions, and tables created here, in dependency order. Do not
-- drop tables after they contain user data; preserve/export that data first.

BEGIN;

CREATE TABLE public.primepro_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL
    REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '',
  technical_requirements text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Not Started'
    CHECK (status IN (
      'Not Started', 'Assigned', 'In Progress', 'On Hold',
      'Under Review', 'Completed', 'Cancelled'
    )),
  due_at timestamptz,
  created_by text NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);

CREATE TABLE public.primepro_project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  organization_id text NOT NULL,
  user_id text NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_by text NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT primepro_project_members_project_org_fkey
    FOREIGN KEY (project_id, organization_id)
    REFERENCES public.primepro_projects(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT primepro_project_members_unique UNIQUE (project_id, user_id)
);

CREATE TABLE public.primepro_project_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  organization_id text NOT NULL,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  instructions text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'Medium'
    CHECK (priority IN ('Low', 'Medium', 'High', 'Urgent')),
  status text NOT NULL DEFAULT 'Not Started'
    CHECK (status IN (
      'Not Started', 'In Progress', 'Under Review',
      'Changes Requested', 'Completed', 'Cancelled'
    )),
  progress smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  due_at timestamptz,
  assigned_to text REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_by text NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  submission_note text NOT NULL DEFAULT '',
  submitted_at timestamptz,
  review_note text NOT NULL DEFAULT '',
  reviewed_by text REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT primepro_project_tasks_project_org_fkey
    FOREIGN KEY (project_id, organization_id)
    REFERENCES public.primepro_projects(id, organization_id) ON DELETE CASCADE,
  UNIQUE (id, organization_id)
);

CREATE TABLE public.primepro_project_task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  organization_id text NOT NULL,
  author_id text NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT primepro_project_task_comments_task_org_fkey
    FOREIGN KEY (task_id, organization_id)
    REFERENCES public.primepro_project_tasks(id, organization_id) ON DELETE CASCADE
);

CREATE TABLE public.primepro_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL
    REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  recipient_id text NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (char_length(event_type) <= 80),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 500),
  target_type text NOT NULL CHECK (target_type IN ('project', 'project_task')),
  target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE TABLE public.primepro_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL
    REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  actor_id text,
  event_type text NOT NULL CHECK (char_length(event_type) <= 100),
  target_type text NOT NULL CHECK (char_length(target_type) <= 80),
  target_id text NOT NULL,
  before_values jsonb,
  after_values jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX primepro_projects_org_status_idx
  ON public.primepro_projects (organization_id, status, due_at);
CREATE INDEX primepro_project_members_user_idx
  ON public.primepro_project_members (organization_id, user_id, project_id);
CREATE INDEX primepro_project_tasks_assignee_idx
  ON public.primepro_project_tasks (organization_id, assigned_to, status, due_at);
CREATE INDEX primepro_project_tasks_project_idx
  ON public.primepro_project_tasks (project_id, status);
CREATE INDEX primepro_project_task_comments_task_idx
  ON public.primepro_project_task_comments (task_id, created_at);
CREATE INDEX primepro_notifications_recipient_idx
  ON public.primepro_notifications (recipient_id, created_at DESC);
CREATE INDEX primepro_notifications_unread_idx
  ON public.primepro_notifications (recipient_id, read_at, created_at DESC);
CREATE INDEX primepro_audit_log_org_time_idx
  ON public.primepro_audit_log (organization_id, occurred_at DESC);
CREATE INDEX primepro_audit_log_actor_idx
  ON public.primepro_audit_log (actor_id, occurred_at DESC);
CREATE INDEX primepro_audit_log_event_idx
  ON public.primepro_audit_log (organization_id, event_type, occurred_at DESC);
CREATE INDEX primepro_audit_log_target_idx
  ON public.primepro_audit_log (organization_id, target_type, target_id);

-- This scope helper extends the existing hierarchy by one level so Managers
-- can act on Developers assigned beneath their Sales Executives. It never
-- grants cross-organization visibility.
CREATE FUNCTION public.primepro_can_view_member(
  target_org_id text,
  target_user_id text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND (
      public.crm_is_super_admin()
      OR (
        target_org_id = public.crm_org()
        AND (
          public.crm_is_company_admin(target_org_id)
          OR target_user_id = auth.uid()::text
          OR public.crm_can_view_member(target_user_id)
          OR EXISTS (
            SELECT 1
            FROM public.reporting_lines manager_line
            WHERE manager_line.organization_id = target_org_id
              AND manager_line.manager_id = auth.uid()::text
              AND manager_line.executive_id = target_user_id
          )
          OR EXISTS (
            SELECT 1
            FROM public.reporting_lines manager_line
            JOIN public.reporting_lines executive_line
              ON executive_line.manager_id = manager_line.executive_id
             AND executive_line.organization_id = manager_line.organization_id
            WHERE manager_line.organization_id = target_org_id
              AND manager_line.manager_id = auth.uid()::text
              AND executive_line.executive_id = target_user_id
          )
        )
      )
    );
$function$;

CREATE FUNCTION public.primepro_project_visible(target_project_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.primepro_projects project
    WHERE project.id = target_project_id
      AND (
        public.crm_is_super_admin()
        OR (
          project.organization_id = public.crm_org()
          AND (
            public.crm_is_company_admin(project.organization_id)
            OR project.created_by = auth.uid()::text
            OR EXISTS (
              SELECT 1
              FROM public.primepro_project_members member
              WHERE member.project_id = project.id
                AND public.primepro_can_view_member(
                  project.organization_id, member.user_id
                )
            )
          )
        )
      )
  );
$function$;

CREATE FUNCTION public.primepro_can_manage_project(
  target_project_id uuid,
  target_org_id text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.primepro_projects project
    WHERE project.id = target_project_id
      AND project.organization_id = target_org_id
      AND (
        public.crm_is_super_admin()
        OR (
          target_org_id = public.crm_org()
          AND (
            public.crm_is_company_admin(target_org_id)
            OR (
              public.crm_is_manager(target_org_id)
              AND (
                project.created_by = auth.uid()::text
                OR EXISTS (
                  SELECT 1
                  FROM public.primepro_project_members member
                  WHERE member.project_id = project.id
                    AND public.primepro_can_view_member(
                      target_org_id, member.user_id
                    )
                )
              )
            )
          )
        )
      )
  );
$function$;

CREATE FUNCTION public.primepro_can_view_project_task(target_task_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.primepro_project_tasks task
    WHERE task.id = target_task_id
      AND (
        public.crm_is_super_admin()
        OR (
          task.organization_id = public.crm_org()
          AND (
            public.crm_is_company_admin(task.organization_id)
            OR (
              task.assigned_to = auth.uid()::text
              AND EXISTS (
                SELECT 1
                FROM public.primepro_project_members own_membership
                WHERE own_membership.project_id = task.project_id
                  AND own_membership.user_id = auth.uid()::text
              )
            )
            OR public.primepro_can_manage_project(
              task.project_id, task.organization_id
            )
            OR (
              EXISTS (
                SELECT 1
                FROM public.user_roles viewer_role
                WHERE viewer_role.user_id = auth.uid()::text
                  AND viewer_role.organization_id = task.organization_id
                  AND viewer_role.role IN (
                    'Executive', 'Sales Executive', 'Sales Executive 1',
                    'Sales Executive 2', 'Sales Executive 3', 'Sales Rep',
                    'Telecaller'
                  )
              )
              AND EXISTS (
                SELECT 1
                FROM public.primepro_project_members viewer_member
                JOIN public.user_roles assignee_role
                  ON assignee_role.user_id = task.assigned_to
                 AND assignee_role.organization_id = task.organization_id
                WHERE viewer_member.project_id = task.project_id
                  AND viewer_member.user_id = auth.uid()::text
                  AND assignee_role.role = 'Developer'
              )
            )
          )
        )
      )
  );
$function$;

CREATE FUNCTION public.primepro_validate_project_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles target_role
    WHERE target_role.user_id = NEW.user_id
      AND target_role.organization_id = NEW.organization_id
      AND target_role.role IN (
        'Developer', 'Executive', 'Sales Executive', 'Sales Executive 1',
        'Sales Executive 2', 'Sales Executive 3', 'Sales Rep', 'Telecaller'
      )
  ) THEN
    RAISE EXCEPTION 'Project members must have an eligible role in this organization'
      USING ERRCODE = '23514';
  END IF;
  IF NOT public.primepro_can_view_member(NEW.organization_id, NEW.user_id) THEN
    RAISE EXCEPTION 'Cannot assign a project member outside the authorized team'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER primepro_validate_project_member
  BEFORE INSERT OR UPDATE ON public.primepro_project_members
  FOR EACH ROW EXECUTE FUNCTION public.primepro_validate_project_member();

CREATE FUNCTION public.primepro_validate_project_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.primepro_project_members member
    JOIN public.user_roles target_role
      ON target_role.user_id = member.user_id
     AND target_role.organization_id = member.organization_id
    WHERE member.project_id = NEW.project_id
      AND member.organization_id = NEW.organization_id
      AND member.user_id = NEW.assigned_to
      AND target_role.role IN (
        'Developer', 'Executive', 'Sales Executive', 'Sales Executive 1',
        'Sales Executive 2', 'Sales Executive 3', 'Sales Rep', 'Telecaller'
      )
  ) THEN
    RAISE EXCEPTION 'Tasks can only be assigned to eligible members of the project'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
  THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.project_id IS DISTINCT FROM OLD.project_id
      OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'Project task identity and ownership fields are immutable'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NOT public.primepro_can_manage_project(OLD.project_id, OLD.organization_id)
  THEN
    IF OLD.assigned_to IS DISTINCT FROM auth.uid()::text
      OR NEW.id IS DISTINCT FROM OLD.id
      OR NEW.project_id IS DISTINCT FROM OLD.project_id
      OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.title IS DISTINCT FROM OLD.title
      OR NEW.instructions IS DISTINCT FROM OLD.instructions
      OR NEW.priority IS DISTINCT FROM OLD.priority
      OR NEW.due_at IS DISTINCT FROM OLD.due_at
      OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.review_note IS DISTINCT FROM OLD.review_note
      OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
      OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
      OR NEW.status NOT IN ('In Progress', 'Under Review')
      OR OLD.status IN ('Completed', 'Cancelled')
    THEN
      RAISE EXCEPTION 'Assignees may only update their task progress and submit work for review'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER primepro_validate_project_task
  BEFORE INSERT OR UPDATE ON public.primepro_project_tasks
  FOR EACH ROW EXECUTE FUNCTION public.primepro_validate_project_task();

-- Immutable event log. Snapshots deliberately exclude free-form descriptions,
-- instructions, comments, customer data, and credentials.
CREATE FUNCTION public.primepro_log_project_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  old_snapshot jsonb;
  new_snapshot jsonb;
  event_name text;
  target_org text;
  target_key text;
BEGIN
  IF TG_TABLE_NAME = 'primepro_projects' THEN
    target_org := COALESCE(NEW.organization_id, OLD.organization_id);
    target_key := COALESCE(NEW.id, OLD.id)::text;
    IF TG_OP <> 'INSERT' THEN
      old_snapshot := jsonb_build_object(
        'title', OLD.title, 'status', OLD.status, 'due_at', OLD.due_at
      );
    END IF;
    IF TG_OP <> 'DELETE' THEN
      new_snapshot := jsonb_build_object(
        'title', NEW.title, 'status', NEW.status, 'due_at', NEW.due_at
      );
    END IF;
    event_name := CASE
      WHEN TG_OP = 'INSERT' THEN 'project.created'
      WHEN TG_OP = 'DELETE' THEN 'project.deleted'
      WHEN OLD.status IS DISTINCT FROM NEW.status THEN 'project.status_changed'
      ELSE 'project.updated'
    END;
  ELSE
    target_org := COALESCE(NEW.organization_id, OLD.organization_id);
    target_key := COALESCE(NEW.id, OLD.id)::text;
    IF TG_OP <> 'INSERT' THEN
      old_snapshot := jsonb_build_object(
        'title', OLD.title, 'status', OLD.status, 'priority', OLD.priority,
        'due_at', OLD.due_at, 'assigned_to', OLD.assigned_to, 'progress', OLD.progress
      );
    END IF;
    IF TG_OP <> 'DELETE' THEN
      new_snapshot := jsonb_build_object(
        'title', NEW.title, 'status', NEW.status, 'priority', NEW.priority,
        'due_at', NEW.due_at, 'assigned_to', NEW.assigned_to, 'progress', NEW.progress
      );
    END IF;
    event_name := CASE
      WHEN TG_OP = 'INSERT' THEN 'project_task.created'
      WHEN TG_OP = 'DELETE' THEN 'project_task.deleted'
      WHEN OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN 'project_task.reassigned'
      WHEN OLD.status IS DISTINCT FROM NEW.status THEN 'project_task.status_changed'
      ELSE 'project_task.updated'
    END;
  END IF;

  INSERT INTO public.primepro_audit_log (
    organization_id, actor_id, event_type, target_type, target_id,
    before_values, after_values
  ) VALUES (
    target_org, auth.uid()::text, event_name,
    CASE WHEN TG_TABLE_NAME = 'primepro_projects' THEN 'project' ELSE 'project_task' END,
    target_key, old_snapshot, new_snapshot
  );

  RETURN NULL;
END;
$function$;

CREATE TRIGGER primepro_audit_project_change
  AFTER INSERT OR UPDATE ON public.primepro_projects
  FOR EACH ROW EXECUTE FUNCTION public.primepro_log_project_change();
CREATE TRIGGER primepro_audit_task_change
  AFTER INSERT OR UPDATE ON public.primepro_project_tasks
  FOR EACH ROW EXECUTE FUNCTION public.primepro_log_project_change();

CREATE FUNCTION public.primepro_validate_project_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Project identity and ownership fields are immutable'
      USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER primepro_validate_project_update
  BEFORE UPDATE ON public.primepro_projects
  FOR EACH ROW EXECUTE FUNCTION public.primepro_validate_project_update();

CREATE FUNCTION public.primepro_log_project_member_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.primepro_audit_log (
      organization_id, actor_id, event_type, target_type, target_id,
      before_values
    ) VALUES (
      OLD.organization_id, auth.uid()::text, 'project.member_removed',
      'project', OLD.project_id::text,
      jsonb_build_object('user_id', OLD.user_id)
    );
    RETURN OLD;
  END IF;

  INSERT INTO public.primepro_audit_log (
    organization_id, actor_id, event_type, target_type, target_id,
    after_values
  ) VALUES (
    NEW.organization_id, auth.uid()::text, 'project.member_added',
    'project', NEW.project_id::text,
    jsonb_build_object('user_id', NEW.user_id)
  );
  RETURN NEW;
END;
$function$;

CREATE TRIGGER primepro_audit_project_member_change
  AFTER INSERT OR DELETE ON public.primepro_project_members
  FOR EACH ROW EXECUTE FUNCTION public.primepro_log_project_member_change();

CREATE FUNCTION public.primepro_prevent_removing_assignee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.primepro_project_tasks task
    WHERE task.project_id = OLD.project_id
      AND task.organization_id = OLD.organization_id
      AND task.assigned_to = OLD.user_id
  ) THEN
    RAISE EXCEPTION 'Reassign or unassign this member’s tasks before removing them from the project'
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE TRIGGER primepro_prevent_removing_assignee
  BEFORE DELETE ON public.primepro_project_members
  FOR EACH ROW EXECUTE FUNCTION public.primepro_prevent_removing_assignee();

CREATE FUNCTION public.primepro_log_project_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  INSERT INTO public.primepro_audit_log (
    organization_id, actor_id, event_type, target_type, target_id
  ) VALUES (
    NEW.organization_id, NEW.author_id, 'project_task.comment_added',
    'project_task', NEW.task_id::text
  );
  RETURN NEW;
END;
$function$;

CREATE TRIGGER primepro_audit_project_comment
  AFTER INSERT ON public.primepro_project_task_comments
  FOR EACH ROW EXECUTE FUNCTION public.primepro_log_project_comment();

CREATE FUNCTION public.primepro_notify_project_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  INSERT INTO public.primepro_notifications (
    organization_id, recipient_id, event_type, message, target_type, target_id
  )
  SELECT NEW.organization_id, NEW.user_id, 'project.assigned',
    'You were added to a project.', 'project', NEW.project_id
  WHERE NEW.user_id <> COALESCE(auth.uid()::text, '');
  RETURN NEW;
END;
$function$;

CREATE TRIGGER primepro_project_member_notification
  AFTER INSERT ON public.primepro_project_members
  FOR EACH ROW EXECUTE FUNCTION public.primepro_notify_project_member();

CREATE FUNCTION public.primepro_notify_project_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.primepro_notifications (
      organization_id, recipient_id, event_type, message, target_type, target_id
    )
    SELECT NEW.organization_id, recipients.user_id, 'project.status_updated',
      'A project status was updated.', 'project', NEW.id
    FROM (
      SELECT member.user_id
      FROM public.primepro_project_members member
      WHERE member.project_id = NEW.id
        AND member.organization_id = NEW.organization_id
      UNION
      SELECT NEW.created_by
    ) recipients
    WHERE recipients.user_id <> COALESCE(auth.uid()::text, '');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER primepro_project_status_notification
  AFTER UPDATE ON public.primepro_projects
  FOR EACH ROW EXECUTE FUNCTION public.primepro_notify_project_status();

CREATE FUNCTION public.primepro_notify_project_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  notification_type text;
  notification_message text;
BEGIN
  IF NEW.assigned_to IS NOT NULL
    AND (TG_OP = 'INSERT' OR OLD.assigned_to IS DISTINCT FROM NEW.assigned_to)
    AND NEW.assigned_to <> COALESCE(auth.uid()::text, '')
  THEN
    notification_type := CASE WHEN TG_OP = 'INSERT'
      THEN 'project_task.assigned' ELSE 'project_task.reassigned' END;
    notification_message := CASE WHEN TG_OP = 'INSERT'
      THEN 'A project task was assigned to you.'
      ELSE 'A project task was reassigned to you.' END;
    INSERT INTO public.primepro_notifications (
      organization_id, recipient_id, event_type, message, target_type, target_id
    ) VALUES (
      NEW.organization_id, NEW.assigned_to, notification_type,
      notification_message, 'project_task', NEW.id
    );
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.status IS DISTINCT FROM NEW.status
    AND OLD.assigned_to IS NOT NULL
    AND OLD.assigned_to <> COALESCE(auth.uid()::text, '')
    AND NEW.status IN ('Completed', 'Changes Requested')
  THEN
    INSERT INTO public.primepro_notifications (
      organization_id, recipient_id, event_type, message, target_type, target_id
    ) VALUES (
      NEW.organization_id, OLD.assigned_to,
      CASE NEW.status
        WHEN 'Completed' THEN 'project_task.approved'
        ELSE 'project_task.changes_requested'
      END,
      CASE NEW.status
        WHEN 'Completed' THEN 'Your project task was approved.'
        ELSE 'Changes were requested on your project task.'
      END,
      'project_task', NEW.id
    );
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.status IS DISTINCT FROM NEW.status
    AND NEW.status = 'Under Review'
  THEN
    INSERT INTO public.primepro_notifications (
      organization_id, recipient_id, event_type, message, target_type, target_id
    )
    SELECT project.organization_id, project.created_by,
      'project_task.submitted', 'A project task was submitted for review.',
      'project_task', NEW.id
    FROM public.primepro_projects project
    WHERE project.id = NEW.project_id
      AND project.organization_id = NEW.organization_id
      AND project.created_by <> COALESCE(auth.uid()::text, '');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER primepro_project_task_notification
  AFTER INSERT OR UPDATE ON public.primepro_project_tasks
  FOR EACH ROW EXECUTE FUNCTION public.primepro_notify_project_task();

CREATE FUNCTION public.primepro_notify_project_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  task_assignee text;
  project_creator text;
BEGIN
  SELECT task.assigned_to, project.created_by
  INTO task_assignee, project_creator
  FROM public.primepro_project_tasks task
  JOIN public.primepro_projects project
    ON project.id = task.project_id
   AND project.organization_id = task.organization_id
  WHERE task.id = NEW.task_id
    AND task.organization_id = NEW.organization_id;
  INSERT INTO public.primepro_notifications (
    organization_id, recipient_id, event_type, message, target_type, target_id
  )
  SELECT NEW.organization_id, recipients.user_id, 'project_task.comment',
    'A comment was added to a project task.', 'project_task', NEW.task_id
  FROM (
    SELECT task_assignee AS user_id
    UNION
    SELECT project_creator
  ) recipients
  WHERE recipients.user_id IS NOT NULL
    AND recipients.user_id <> NEW.author_id;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER primepro_project_comment_notification
  AFTER INSERT ON public.primepro_project_task_comments
  FOR EACH ROW EXECUTE FUNCTION public.primepro_notify_project_comment();

CREATE FUNCTION public.primepro_reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'PrimePro audit entries are append-only'
    USING ERRCODE = '42501';
END;
$function$;

CREATE TRIGGER primepro_audit_no_update_delete
  BEFORE UPDATE OR DELETE ON public.primepro_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.primepro_reject_audit_mutation();

CREATE FUNCTION public.primepro_validate_notification_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
    OR NEW.event_type IS DISTINCT FROM OLD.event_type
    OR NEW.message IS DISTINCT FROM OLD.message
    OR NEW.target_type IS DISTINCT FROM OLD.target_type
    OR NEW.target_id IS DISTINCT FROM OLD.target_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Notification content and recipient are immutable'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER primepro_validate_notification_update
  BEFORE UPDATE ON public.primepro_notifications
  FOR EACH ROW EXECUTE FUNCTION public.primepro_validate_notification_update();

ALTER TABLE public.primepro_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.primepro_project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.primepro_project_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.primepro_project_task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.primepro_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.primepro_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY primepro_projects_select ON public.primepro_projects
  FOR SELECT TO authenticated
  USING (public.primepro_project_visible(id));
CREATE POLICY primepro_projects_insert ON public.primepro_projects
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      organization_id = public.crm_org()
      OR public.crm_is_super_admin()
    )
    AND created_by = auth.uid()::text
    AND (
      public.crm_is_company_admin(organization_id)
      OR public.crm_is_manager(organization_id)
    )
  );
CREATE POLICY primepro_projects_update ON public.primepro_projects
  FOR UPDATE TO authenticated
  USING (public.primepro_can_manage_project(id, organization_id))
  WITH CHECK (public.primepro_can_manage_project(id, organization_id));

CREATE POLICY primepro_project_members_select ON public.primepro_project_members
  FOR SELECT TO authenticated
  USING (public.primepro_project_visible(project_id));
CREATE POLICY primepro_project_members_insert ON public.primepro_project_members
  FOR INSERT TO authenticated
  WITH CHECK (
    assigned_by = auth.uid()::text
    AND public.primepro_can_manage_project(project_id, organization_id)
  );
CREATE POLICY primepro_project_members_delete ON public.primepro_project_members
  FOR DELETE TO authenticated
  USING (public.primepro_can_manage_project(project_id, organization_id));

CREATE POLICY primepro_project_tasks_select ON public.primepro_project_tasks
  FOR SELECT TO authenticated
  USING (public.primepro_can_view_project_task(id));
CREATE POLICY primepro_project_tasks_insert ON public.primepro_project_tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()::text
    AND public.primepro_can_manage_project(project_id, organization_id)
  );
CREATE POLICY primepro_project_tasks_update ON public.primepro_project_tasks
  FOR UPDATE TO authenticated
  USING (
    public.primepro_can_manage_project(project_id, organization_id)
    OR (
      organization_id = public.crm_org()
      AND assigned_to = auth.uid()::text
      AND EXISTS (
        SELECT 1
        FROM public.primepro_project_members own_membership
        WHERE own_membership.project_id = primepro_project_tasks.project_id
          AND own_membership.user_id = auth.uid()::text
      )
    )
  )
  WITH CHECK (
    public.primepro_can_manage_project(project_id, organization_id)
    OR (
      organization_id = public.crm_org()
      AND assigned_to = auth.uid()::text
      AND EXISTS (
        SELECT 1
        FROM public.primepro_project_members own_membership
        WHERE own_membership.project_id = primepro_project_tasks.project_id
          AND own_membership.user_id = auth.uid()::text
      )
    )
  );

CREATE POLICY primepro_project_task_comments_select
  ON public.primepro_project_task_comments
  FOR SELECT TO authenticated
  USING (public.primepro_can_view_project_task(task_id));
CREATE POLICY primepro_project_task_comments_insert
  ON public.primepro_project_task_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()::text
    AND public.primepro_can_view_project_task(task_id)
  );

CREATE POLICY primepro_notifications_select ON public.primepro_notifications
  FOR SELECT TO authenticated
  USING (
    recipient_id = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public.user_roles member_role
      WHERE member_role.user_id = auth.uid()::text
        AND member_role.organization_id = organization_id
    )
  );
CREATE POLICY primepro_notifications_update_read
  ON public.primepro_notifications
  FOR UPDATE TO authenticated
  USING (
    recipient_id = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public.user_roles member_role
      WHERE member_role.user_id = auth.uid()::text
        AND member_role.organization_id = organization_id
    )
  )
  WITH CHECK (
    recipient_id = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public.user_roles member_role
      WHERE member_role.user_id = auth.uid()::text
        AND member_role.organization_id = organization_id
    )
  );

CREATE POLICY primepro_audit_log_select ON public.primepro_audit_log
  FOR SELECT TO authenticated
  USING (
    public.crm_is_super_admin()
    OR (
      organization_id = public.crm_org()
      AND (
        public.crm_is_company_admin(organization_id)
        OR actor_id = auth.uid()::text
        OR (
          public.crm_is_manager(organization_id)
          AND actor_id IS NOT NULL
          AND public.primepro_can_view_member(organization_id, actor_id)
        )
      )
    )
  );

REVOKE ALL ON FUNCTION public.primepro_can_view_member(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.primepro_project_visible(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.primepro_can_manage_project(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.primepro_can_view_project_task(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.primepro_validate_project_member() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.primepro_validate_project_task() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.primepro_prevent_removing_assignee() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.primepro_validate_project_update() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.primepro_validate_notification_update() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.primepro_log_project_change() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.primepro_log_project_comment() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.primepro_log_project_member_change() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.primepro_notify_project_member() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.primepro_notify_project_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.primepro_notify_project_task() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.primepro_notify_project_comment() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.primepro_reject_audit_mutation() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.primepro_can_view_member(text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.primepro_project_visible(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.primepro_can_manage_project(uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.primepro_can_view_project_task(uuid)
  TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.primepro_projects TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.primepro_project_members TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.primepro_project_tasks TO authenticated;
GRANT SELECT, INSERT ON public.primepro_project_task_comments TO authenticated;
GRANT SELECT ON public.primepro_notifications TO authenticated;
GRANT UPDATE (read_at) ON public.primepro_notifications TO authenticated;
GRANT SELECT ON public.primepro_audit_log TO authenticated;

GRANT ALL ON public.primepro_projects TO service_role;
GRANT ALL ON public.primepro_project_members TO service_role;
GRANT ALL ON public.primepro_project_tasks TO service_role;
GRANT ALL ON public.primepro_project_task_comments TO service_role;
GRANT ALL ON public.primepro_notifications TO service_role;
GRANT ALL ON public.primepro_audit_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.primepro_audit_log_id_seq TO service_role;

COMMIT;

-- Known gaps requiring separate design/approval:
-- 1. Supabase Auth events (failed/successful logins, reset, logout, session
--    expiry) need Auth Hooks or a trusted server/Edge Function; client audit
--    claims are not authoritative.
-- 2. Deadline reminders/overdue alerts need an approved scheduler/cron source.
-- 3. File uploads need a separate private Storage bucket and object policies.
-- 4. User provisioning, activation, role changes, and password reset require
--    privileged server endpoints and guarded existing RPCs; this SQL does not
--    expose service-role operations to browsers.
-- 5. Existing role-management RPCs and the current crm_can_view_member /
--    reporting-line validation functions must be separately reviewed before
--    adding numbered Sales Executive roles to database-side authorization.
