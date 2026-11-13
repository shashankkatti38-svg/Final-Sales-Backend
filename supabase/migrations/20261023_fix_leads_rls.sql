-- Migration: Fix leads RLS INSERT policy
-- Date: 2026-10-23

CREATE OR REPLACE FUNCTION public.set_default_lead_org()
RETURNS TRIGGER AS $$
DECLARE
  v_org text;
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT organization_id INTO v_org
    FROM public.user_roles
    WHERE user_id = auth.uid()::text
    LIMIT 1;
    IF v_org IS NULL THEN
      v_org := ''4df15334-08f1-4ea8-a764-c36266fbfdba'';
    END IF;
    NEW.organization_id := v_org;
  END IF;
  IF NEW.owner_id IS NULL AND auth.uid() IS NOT NULL THEN
    NEW.owner_id := auth.uid()::text;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP POLICY IF EXISTS leads_insert_policy ON public.leads;
CREATE POLICY leads_insert_policy ON public.leads
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = public.crm_org()
  AND (
    owner_id = (auth.uid())::text
    OR owner_id IS NULL
    OR public.crm_is_admin()
  )
);