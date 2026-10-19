ALTER TABLE public.sales_documents ADD COLUMN IF NOT EXISTS tax_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100);
ALTER TABLE public.sales_documents ADD COLUMN IF NOT EXISTS tax_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0);
ALTER TABLE public.sales_documents ADD COLUMN IF NOT EXISTS discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);

CREATE OR REPLACE FUNCTION public.validate_sales_document() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  subtotal numeric:=0;
  expected_total numeric:=0;
  item jsonb;
  parent public.sales_documents;
BEGIN
  IF jsonb_typeof(NEW.items) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.items)=0 OR jsonb_array_length(NEW.items)>100 THEN
    RAISE EXCEPTION 'Add between 1 and 100 line items';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
    IF item->>'name' IS NULL OR length(trim(item->>'name'))=0 OR item->>'quantity' IS NULL OR item->>'price' IS NULL OR (item->>'quantity')::numeric<=0 OR (item->>'quantity')::numeric>1000000 OR (item->>'price')::numeric<0 OR (item->>'price')::numeric>999999999999 THEN
      RAISE EXCEPTION 'Invalid line item';
    END IF;
    subtotal:=subtotal+round((item->>'quantity')::numeric*(item->>'price')::numeric,2);
  END LOOP;

  expected_total := round(subtotal - coalesce(NEW.discount_amount, 0) + coalesce(NEW.tax_amount, 0), 2);
  IF expected_total < 0 THEN
    RAISE EXCEPTION 'Discount cannot exceed line items subtotal';
  END IF;

  IF NEW.total IS DISTINCT FROM expected_total THEN
    RAISE EXCEPTION 'Document total must match line items minus discount plus tax';
  END IF;

  IF NEW.parent_id IS NOT NULL THEN
    SELECT * INTO parent FROM public.sales_documents WHERE id=NEW.parent_id;
    IF parent.id IS NULL OR parent.owner_id<>NEW.owner_id OR parent.organization_id<>NEW.organization_id OR parent.lead_id<>NEW.lead_id OR parent.status<>'Issued' OR NOT ((NEW.kind='Order' AND parent.kind='Quotation') OR (NEW.kind='Invoice' AND parent.kind='Order')) THEN
      RAISE EXCEPTION 'Invalid document link';
    END IF;
  END IF;

  IF TG_OP='UPDATE' THEN
    IF NEW.items IS DISTINCT FROM OLD.items OR NEW.total<>OLD.total OR NEW.kind<>OLD.kind OR NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.lead_id<>OLD.lead_id OR NEW.owner_id<>OLD.owner_id OR NEW.organization_id<>OLD.organization_id OR NEW.tax_rate IS DISTINCT FROM OLD.tax_rate OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount THEN
      RAISE EXCEPTION 'Document financial details are immutable';
    END IF;
    IF NEW.status='Cancelled' AND (EXISTS(SELECT 1 FROM public.payments WHERE invoice_id=OLD.id) OR EXISTS(SELECT 1 FROM public.sales_documents WHERE parent_id=OLD.id AND status<>'Cancelled')) THEN
      RAISE EXCEPTION 'Cannot cancel a paid or linked document';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT public.crm_org() REFERENCES public.organizations(id),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL CHECK (char_length(name) <= 100),
  category text NOT NULL DEFAULT 'General' CHECK (category IN ('General','Proposal','Follow-up','Payment','Greeting')),
  body text NOT NULL CHECK (char_length(body) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_templates TO authenticated;
GRANT ALL ON public.whatsapp_templates TO service_role;

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'whatsapp_templates' AND policyname = 'org_whatsapp_templates'
  ) THEN
    CREATE POLICY org_whatsapp_templates ON public.whatsapp_templates
      FOR ALL TO authenticated
      USING (organization_id = public.crm_org())
      WITH CHECK (organization_id = public.crm_org());
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ensure_digital_card_slug()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.slug IS NULL OR length(trim(NEW.slug)) = 0 THEN
    IF TG_OP = 'UPDATE' AND OLD.slug IS NOT NULL AND length(trim(OLD.slug)) > 0 THEN
      NEW.slug := OLD.slug;
    ELSE
      NEW.slug := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ensure_digital_card_slug ON public.digital_cards;
CREATE TRIGGER ensure_digital_card_slug
  BEFORE INSERT OR UPDATE ON public.digital_cards
  FOR EACH ROW EXECUTE FUNCTION public.ensure_digital_card_slug();

