ALTER TABLE public.sales_documents ADD COLUMN IF NOT EXISTS share_token uuid UNIQUE;
ALTER TABLE public.sales_documents ADD COLUMN IF NOT EXISTS approval text NOT NULL DEFAULT 'Pending' CHECK (approval IN ('Pending','Approved','Rejected'));
ALTER TABLE public.sales_documents ADD COLUMN IF NOT EXISTS approval_name text NOT NULL DEFAULT '' CHECK (char_length(approval_name) <= 100);
ALTER TABLE public.sales_documents ADD COLUMN IF NOT EXISTS approval_note text NOT NULL DEFAULT '' CHECK (char_length(approval_note) <= 1000);
ALTER TABLE public.sales_documents ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS renewal_date date;

CREATE OR REPLACE FUNCTION public.public_quotation(token uuid)
RETURNS TABLE(number text, created_at timestamptz, items jsonb, total numeric, approval text, approval_name text, approved_at timestamptz, lead_name text, company text, org_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT d.number, d.created_at, d.items, d.total, d.approval, d.approval_name, d.approved_at, l.name, l.company, o.name
 FROM public.sales_documents d JOIN public.leads l ON l.id=d.lead_id JOIN public.organizations o ON o.id=d.organization_id
 WHERE d.share_token=token AND d.kind='Quotation' AND d.status='Issued' $$;

CREATE OR REPLACE FUNCTION public.respond_quotation(token uuid, decision text, signer text, note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.sales_documents; BEGIN
 IF decision NOT IN ('Approved','Rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
 IF length(trim(coalesce(signer,'')))=0 OR length(signer)>100 OR length(coalesce(note,''))>1000 THEN RAISE EXCEPTION 'Enter your name (max 100 characters)'; END IF;
 SELECT * INTO d FROM public.sales_documents WHERE share_token=token AND kind='Quotation' AND status='Issued' FOR UPDATE;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Quotation not available'; END IF;
 IF d.approval<>'Pending' THEN RAISE EXCEPTION 'This quotation was already answered'; END IF;
 UPDATE public.sales_documents SET approval=decision, approval_name=trim(signer), approval_note=coalesce(note,''), approved_at=now() WHERE id=d.id;
 INSERT INTO public.activities(organization_id,owner_id,lead_id,type,notes) VALUES(d.organization_id,d.owner_id,d.lead_id,'Note','Quotation '||d.number||' '||lower(decision)||' online by '||trim(signer));
END $$;
REVOKE ALL ON FUNCTION public.public_quotation(uuid) FROM public;
REVOKE ALL ON FUNCTION public.respond_quotation(uuid,text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.public_quotation(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_quotation(uuid,text,text,text) TO anon, authenticated;