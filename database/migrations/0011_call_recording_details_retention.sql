ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS transcript text, ADD COLUMN IF NOT EXISTS summary text, ADD COLUMN IF NOT EXISTS recording_deleted_at timestamptz;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS recording_retention_days integer NOT NULL DEFAULT 90 CHECK (recording_retention_days BETWEEN 1 AND 3650);
DROP POLICY IF EXISTS own_call_logs ON public.call_logs;
CREATE POLICY read_call_logs ON public.call_logs FOR SELECT TO authenticated USING (organization_id=public.crm_org() AND (owner_id=auth.uid() OR public.crm_is_admin()));
REVOKE INSERT, UPDATE, DELETE ON public.call_logs FROM authenticated;
CREATE POLICY admin_read_org_recordings ON storage.objects FOR SELECT TO authenticated USING (bucket_id='call-recordings' AND public.crm_is_admin() AND EXISTS(SELECT 1 FROM public.call_logs c WHERE c.recording_path=storage.objects.name AND c.organization_id=public.crm_org()));