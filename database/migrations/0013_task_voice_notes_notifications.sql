ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000);
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS task_type text NOT NULL DEFAULT 'Follow-up' CHECK (char_length(task_type) <= 40);
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS repeat text NOT NULL DEFAULT 'None' CHECK (repeat IN ('None','Daily','Weekly','Monthly'));
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS audio_path text CHECK (audio_path IS NULL OR split_part(audio_path,'/',1) = owner_id::text);
CREATE TABLE public.notification_reads (
 user_id uuid NOT NULL DEFAULT auth.uid(),
 key text NOT NULL CHECK (char_length(key) <= 120),
 read_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, key)
);
GRANT SELECT, INSERT, DELETE ON public.notification_reads TO authenticated;
GRANT ALL ON public.notification_reads TO service_role;
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_notification_reads ON public.notification_reads FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY own_task_audio ON storage.objects FOR ALL TO authenticated
 USING (bucket_id = 'task-audio' AND (storage.foldername(name))[1] = auth.uid()::text)
 WITH CHECK (bucket_id = 'task-audio' AND (storage.foldername(name))[1] = auth.uid()::text);