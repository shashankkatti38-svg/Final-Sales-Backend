ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_path text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'Nos' CHECK (char_length(unit) <= 30);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS gst_rate numeric NOT NULL DEFAULT 18 CHECK (gst_rate IN (0,5,12,18,28));
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS shift_start time NOT NULL DEFAULT '10:00';
CREATE POLICY org_product_images ON storage.objects FOR ALL TO authenticated
 USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] = public.crm_org()::text)
 WITH CHECK (bucket_id = 'product-images' AND (storage.foldername(name))[1] = public.crm_org()::text);
CREATE TABLE public.location_shares (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL DEFAULT auth.uid(),
 organization_id uuid NOT NULL DEFAULT public.crm_org() REFERENCES public.organizations(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Break','Ended')),
 lat double precision, lng double precision, accuracy double precision,
 started_at timestamptz NOT NULL DEFAULT now(),
 reported_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.location_shares TO authenticated;
GRANT ALL ON public.location_shares TO service_role;
ALTER TABLE public.location_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_location_shares ON public.location_shares FOR ALL TO authenticated
 USING (owner_id = auth.uid() AND organization_id = public.crm_org())
 WITH CHECK (owner_id = auth.uid() AND organization_id = public.crm_org());
CREATE POLICY admin_read_location_shares ON public.location_shares FOR SELECT TO authenticated
 USING (organization_id = public.crm_org() AND public.crm_is_admin());
CREATE OR REPLACE FUNCTION public.location_share_server_time() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.started_at := now(); END IF;
 IF TG_OP='UPDATE' AND OLD.status='Ended' THEN RAISE EXCEPTION 'This sharing session has ended'; END IF;
 NEW.reported_at := now();
 IF NEW.status='Ended' THEN NEW.ended_at := now(); END IF;
 RETURN NEW; END $$;
CREATE TRIGGER location_share_server_time BEFORE INSERT OR UPDATE ON public.location_shares FOR EACH ROW EXECUTE FUNCTION public.location_share_server_time();