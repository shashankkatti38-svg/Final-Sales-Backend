CREATE POLICY admin_assign_tasks ON public.tasks FOR INSERT TO authenticated
 WITH CHECK (organization_id = public.crm_org() AND public.crm_is_admin()
  AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = tasks.owner_id AND r.organization_id = public.crm_org())
  AND (lead_id IS NULL OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = tasks.lead_id AND l.organization_id = public.crm_org())));