ALTER TABLE public.leads ADD COLUMN address text NOT NULL DEFAULT '';
ALTER TABLE public.leads ADD COLUMN assigned_to uuid;
ALTER TABLE public.organizations ADD COLUMN invite_code text NOT NULL DEFAULT upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
CREATE UNIQUE INDEX organizations_invite_code_key ON public.organizations(invite_code);
CREATE INDEX leads_assigned_to_idx ON public.leads(assigned_to);

CREATE OR REPLACE FUNCTION public.crm_is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND organization_id=public.crm_org() AND role='Organization Admin') $$;

CREATE OR REPLACE FUNCTION public.crm_join(code text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE org uuid; BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
 SELECT id INTO org FROM public.organizations WHERE invite_code=upper(trim(code));
 IF org IS NULL THEN RAISE EXCEPTION 'Invite code not found'; END IF;
 IF org=public.crm_org() THEN RETURN org; END IF;
 UPDATE public.user_roles SET organization_id=org, role='Sales Rep' WHERE user_id=auth.uid();
 RETURN org; END $$;

CREATE OR REPLACE FUNCTION public.crm_remove_member(member uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE org uuid:=public.crm_org(); home uuid; BEGIN
 IF NOT public.crm_is_admin() THEN RAISE EXCEPTION 'Only admins can remove members'; END IF;
 IF member=auth.uid() THEN RAISE EXCEPTION 'You cannot remove yourself'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=member AND organization_id=org) THEN RAISE EXCEPTION 'Not a member'; END IF;
 SELECT id INTO home FROM public.organizations WHERE owner_id=member ORDER BY created_at LIMIT 1;
 UPDATE public.leads SET assigned_to=NULL WHERE organization_id=org AND assigned_to=member;
 UPDATE public.user_roles SET organization_id=home, role='Organization Admin' WHERE user_id=member AND organization_id=org;
END $$;

CREATE OR REPLACE FUNCTION public.crm_assign_lead(lead uuid, rep uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l public.leads; BEGIN
 SELECT * INTO l FROM public.leads WHERE id=lead AND organization_id=public.crm_org();
 IF l.id IS NULL OR NOT (l.owner_id=auth.uid() OR public.crm_is_admin()) THEN RAISE EXCEPTION 'You cannot assign this lead'; END IF;
 IF rep IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=rep AND organization_id=l.organization_id) THEN RAISE EXCEPTION 'Rep is not in your team'; END IF;
 UPDATE public.leads SET assigned_to=rep WHERE id=lead;
 INSERT INTO public.activities(organization_id,owner_id,lead_id,type,notes) VALUES(l.organization_id,auth.uid(),lead,'Note',CASE WHEN rep IS NULL THEN 'Lead unassigned' ELSE 'Lead assigned to '||coalesce((SELECT nullif(display_name,'') FROM public.profiles WHERE id=rep),'team member') END);
END $$;

REVOKE EXECUTE ON FUNCTION public.crm_is_admin(), public.crm_join(text), public.crm_remove_member(uuid), public.crm_assign_lead(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_is_admin(), public.crm_join(text), public.crm_remove_member(uuid), public.crm_assign_lead(uuid,uuid) TO authenticated;

CREATE POLICY team_org_read ON public.organizations FOR SELECT TO authenticated USING (id=public.crm_org());
CREATE POLICY team_profiles_read ON public.profiles FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=profiles.id AND r.organization_id=public.crm_org()));
CREATE POLICY assigned_leads_read ON public.leads FOR SELECT TO authenticated USING (organization_id=public.crm_org() AND (assigned_to=auth.uid() OR public.crm_is_admin()));
CREATE POLICY assigned_leads_update ON public.leads FOR UPDATE TO authenticated USING (organization_id=public.crm_org() AND assigned_to=auth.uid()) WITH CHECK (organization_id=public.crm_org() AND assigned_to=auth.uid());
CREATE POLICY assigned_activities ON public.activities FOR ALL TO authenticated USING (organization_id=public.crm_org() AND EXISTS(SELECT 1 FROM public.leads l WHERE l.id=activities.lead_id AND (l.assigned_to=auth.uid() OR public.crm_is_admin()))) WITH CHECK (owner_id=auth.uid() AND organization_id=public.crm_org() AND EXISTS(SELECT 1 FROM public.leads l WHERE l.id=activities.lead_id AND (l.assigned_to=auth.uid() OR public.crm_is_admin())));