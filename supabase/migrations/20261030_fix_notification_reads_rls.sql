-- Mark-as-read for in-app notifications (production uses user_id text)

CREATE TABLE IF NOT EXISTS public.notification_reads (
  user_id text NOT NULL,
  key text NOT NULL CHECK (char_length(key) <= 120),
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_notification_reads ON public.notification_reads;
DROP POLICY IF EXISTS notification_reads_select ON public.notification_reads;
DROP POLICY IF EXISTS notification_reads_insert ON public.notification_reads;
DROP POLICY IF EXISTS notification_reads_update ON public.notification_reads;
DROP POLICY IF EXISTS notification_reads_delete ON public.notification_reads;

CREATE POLICY notification_reads_select ON public.notification_reads
  FOR SELECT TO authenticated
  USING (user_id = (auth.uid())::text);

CREATE POLICY notification_reads_insert ON public.notification_reads
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (auth.uid())::text);

CREATE POLICY notification_reads_update ON public.notification_reads
  FOR UPDATE TO authenticated
  USING (user_id = (auth.uid())::text)
  WITH CHECK (user_id = (auth.uid())::text);

CREATE POLICY notification_reads_delete ON public.notification_reads
  FOR DELETE TO authenticated
  USING (user_id = (auth.uid())::text);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_reads TO authenticated;
GRANT ALL ON public.notification_reads TO service_role;

CREATE OR REPLACE FUNCTION public.mark_notification_reads(p_keys text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid text := auth.uid()::text;
  k text;
BEGIN
  IF uid IS NULL OR uid = '' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_keys IS NULL OR array_length(p_keys, 1) IS NULL THEN
    RETURN;
  END IF;
  FOREACH k IN ARRAY p_keys LOOP
    IF k IS NULL OR length(trim(k)) = 0 OR length(k) > 120 THEN
      CONTINUE;
    END IF;
    INSERT INTO public.notification_reads (user_id, key)
    VALUES (uid, k)
    ON CONFLICT (user_id, key) DO NOTHING;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notification_reads(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_notification_reads(text[]) TO authenticated;
