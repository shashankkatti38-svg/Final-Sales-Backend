CREATE TABLE public.attendance (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL DEFAULT auth.uid(),
 organization_id uuid NOT NULL DEFAULT public.crm_org() REFERENCES public.organizations(id),
 check_in timestamptz NOT NULL DEFAULT now(),
 check_out timestamptz,
 in_lat double precision, in_lng double precision,
 out_lat double precision, out_lng double precision,
 notes text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.attendance TO authenticated;
GRANT ALL ON public.attendance TO service_role;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_attendance ON public.attendance FOR ALL TO authenticated USING (owner_id=auth.uid() AND organization_id=public.crm_org()) WITH CHECK (owner_id=auth.uid() AND organization_id=public.crm_org());
CREATE POLICY admin_attendance_read ON public.attendance FOR SELECT TO authenticated USING (organization_id=public.crm_org() AND public.crm_is_admin());

CREATE TABLE public.digital_cards (
 owner_id uuid PRIMARY KEY DEFAULT auth.uid(),
 slug text NOT NULL UNIQUE DEFAULT lower(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
 full_name text NOT NULL DEFAULT '',
 title text NOT NULL DEFAULT '',
 company text NOT NULL DEFAULT '',
 phone text NOT NULL DEFAULT '',
 whatsapp text NOT NULL DEFAULT '',
 email text NOT NULL DEFAULT '',
 website text NOT NULL DEFAULT '',
 address text NOT NULL DEFAULT '',
 about text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT card_lengths CHECK (length(full_name)<=100 AND length(title)<=100 AND length(company)<=100 AND length(phone)<=20 AND length(whatsapp)<=20 AND length(email)<=255 AND length(website)<=255 AND length(address)<=300 AND length(about)<=600)
);
GRANT SELECT, INSERT, UPDATE ON public.digital_cards TO authenticated;
GRANT ALL ON public.digital_cards TO service_role;
ALTER TABLE public.digital_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_card ON public.digital_cards FOR ALL TO authenticated USING (owner_id=auth.uid()) WITH CHECK (owner_id=auth.uid());

CREATE OR REPLACE FUNCTION public.public_card(card_slug text)
RETURNS TABLE(full_name text,title text,company text,phone text,whatsapp text,email text,website text,address text,about text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT full_name,title,company,phone,whatsapp,email,website,address,about FROM public.digital_cards WHERE slug=card_slug $$;
REVOKE ALL ON FUNCTION public.public_card(text) FROM public;
GRANT EXECUTE ON FUNCTION public.public_card(text) TO anon, authenticated;