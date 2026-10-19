REVOKE ALL ON FUNCTION public.crm_signup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_org() FROM anon;
GRANT EXECUTE ON FUNCTION public.crm_org() TO authenticated;