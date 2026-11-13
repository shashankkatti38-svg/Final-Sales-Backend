CREATE TABLE public.inbound_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) DEFAULT public.crm_org(),
  phone_number text NOT NULL UNIQUE,
  provider_sid text NOT NULL,
  forward_to text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.inbound_numbers TO authenticated;
GRANT ALL ON public.inbound_numbers TO service_role;
ALTER TABLE public.inbound_numbers ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_inbound_numbers_read ON public.inbound_numbers FOR SELECT TO authenticated USING (organization_id = public.crm_org());

CREATE TABLE public.incoming_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  call_sid text NOT NULL UNIQUE,
  from_number text NOT NULL,
  to_number text NOT NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  lead_name text,
  lead_company text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.incoming_calls TO authenticated;
GRANT ALL ON public.incoming_calls TO service_role;
ALTER TABLE public.incoming_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_incoming_calls_read ON public.incoming_calls FOR SELECT TO authenticated USING (organization_id = public.crm_org());
CREATE INDEX incoming_calls_org_created_idx ON public.incoming_calls(organization_id, created_at DESC);
ALTER PUBLICATION supabase_realtime ADD TABLE public.incoming_calls;