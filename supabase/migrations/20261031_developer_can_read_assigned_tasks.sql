-- Developers can read/update tasks they own or are assigned, even if Super Admin created them.
DROP POLICY IF EXISTS tasks_developer_assigned_select ON public.tasks;
CREATE POLICY tasks_developer_assigned_select ON public.tasks
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()::text
    OR created_by = auth.uid()::text
    OR id IN (
      SELECT ta.task_id
      FROM public.task_assignments ta
      WHERE ta.user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS tasks_developer_assigned_update ON public.tasks;
CREATE POLICY tasks_developer_assigned_update ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    owner_id = auth.uid()::text
    OR id IN (
      SELECT ta.task_id
      FROM public.task_assignments ta
      WHERE ta.user_id = auth.uid()::text
    )
  )
  WITH CHECK (
    owner_id = auth.uid()::text
    OR id IN (
      SELECT ta.task_id
      FROM public.task_assignments ta
      WHERE ta.user_id = auth.uid()::text
    )
  );
