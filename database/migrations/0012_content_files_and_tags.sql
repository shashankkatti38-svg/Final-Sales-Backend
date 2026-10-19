ALTER TABLE public.content_pages ADD COLUMN IF NOT EXISTS tag text NOT NULL DEFAULT '';
CREATE TABLE public.content_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL DEFAULT public.crm_org() REFERENCES public.organizations(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL DEFAULT auth.uid(),
 name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
 description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
 tag text NOT NULL DEFAULT '' CHECK (char_length(tag) <= 60),
 path text NOT NULL UNIQUE,
 mime text NOT NULL DEFAULT '',
 size bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_files TO authenticated;
GRANT ALL ON public.content_files TO service_role;
ALTER TABLE public.content_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_content_files ON public.content_files FOR ALL TO authenticated
 USING (owner_id = auth.uid() AND organization_id = public.crm_org())
 WITH CHECK (owner_id = auth.uid() AND organization_id = public.crm_org() AND split_part(path,'/',1) = auth.uid()::text);
CREATE POLICY own_content_objects ON storage.objects FOR ALL TO authenticated
 USING (bucket_id = 'content-files' AND (storage.foldername(name))[1] = auth.uid()::text)
 WITH CHECK (bucket_id = 'content-files' AND (storage.foldername(name))[1] = auth.uid()::text);