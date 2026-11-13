ALTER TABLE public.organizations ADD COLUMN auto_assign boolean NOT NULL DEFAULT false, ADD COLUMN rr_cursor integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.crm_round_robin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o public.organizations; reps uuid[]; BEGIN
 IF NEW.assigned_to IS NOT NULL THEN RETURN NEW; END IF;
 SELECT * INTO o FROM public.organizations WHERE id=NEW.organization_id FOR UPDATE;
 IF NOT o.auto_assign THEN RETURN NEW; END IF;
 SELECT array_agg(user_id ORDER BY user_id) INTO reps FROM public.user_roles WHERE organization_id=NEW.organization_id AND role='Sales Rep';
 IF reps IS NULL THEN RETURN NEW; END IF;
 NEW.assigned_to:=reps[(o.rr_cursor % array_length(reps,1))+1];
 UPDATE public.organizations SET rr_cursor=rr_cursor+1 WHERE id=o.id;
 RETURN NEW; END $$;
CREATE TRIGGER crm_lead_round_robin BEFORE INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION public.crm_round_robin();

CREATE TABLE public.sales_targets(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL,
 month date NOT NULL,
 revenue numeric NOT NULL DEFAULT 0 CHECK (revenue>=0),
 deals integer NOT NULL DEFAULT 0 CHECK (deals>=0),
 activities integer NOT NULL DEFAULT 0 CHECK (activities>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,user_id,month));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sales_targets TO authenticated;
GRANT ALL ON public.sales_targets TO service_role;
ALTER TABLE public.sales_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team reads targets" ON public.sales_targets FOR SELECT TO authenticated USING (organization_id=public.crm_org());
CREATE POLICY "admins manage targets" ON public.sales_targets FOR ALL TO authenticated USING (organization_id=public.crm_org() AND public.crm_is_admin()) WITH CHECK (organization_id=public.crm_org() AND public.crm_is_admin());

CREATE OR REPLACE FUNCTION public.crm_leaderboard(month_start date)
RETURNS TABLE(user_id uuid, name text, revenue numeric, deals bigint, activities bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
 SELECT r.user_id, coalesce(nullif(p.display_name,''),'Team member'),
  coalesce((SELECT sum(amount) FROM public.payments x WHERE x.organization_id=r.organization_id AND x.owner_id=r.user_id AND x.paid_at>=month_start AND x.paid_at<month_start+interval '1 month'),0),
  (SELECT count(*) FROM public.leads l WHERE l.organization_id=r.organization_id AND coalesce(l.assigned_to,l.owner_id)=r.user_id AND l.status='Delivered'),
  (SELECT count(*) FROM public.activities a WHERE a.organization_id=r.organization_id AND a.owner_id=r.user_id AND a.occurred_at>=month_start AND a.occurred_at<month_start+interval '1 month')
 FROM public.user_roles r LEFT JOIN public.profiles p ON p.id=r.user_id
 WHERE r.organization_id=public.crm_org() $$;
REVOKE ALL ON FUNCTION public.crm_leaderboard(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.crm_leaderboard(date) TO authenticated;

CREATE TABLE public.automation_rules(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
 trigger_event text NOT NULL CHECK (trigger_event IN ('lead_created','status_changed')),
 match_status text NOT NULL DEFAULT '',
 action text NOT NULL CHECK (action IN ('create_task','set_label')),
 task_title text NOT NULL DEFAULT '' CHECK (length(task_title)<=150),
 due_days integer NOT NULL DEFAULT 1 CHECK (due_days BETWEEN 0 AND 365),
 label text NOT NULL DEFAULT '' CHECK (label IN ('','Hot','Warm','Cold')),
 active boolean NOT NULL DEFAULT true,
 runs integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.automation_rules TO authenticated;
GRANT ALL ON public.automation_rules TO service_role;
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team reads rules" ON public.automation_rules FOR SELECT TO authenticated USING (organization_id=public.crm_org());
CREATE POLICY "admins manage rules" ON public.automation_rules FOR ALL TO authenticated USING (organization_id=public.crm_org() AND public.crm_is_admin()) WITH CHECK (organization_id=public.crm_org() AND public.crm_is_admin());

CREATE OR REPLACE FUNCTION public.crm_run_automations() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.automation_rules; ev text; BEGIN
 IF TG_OP='INSERT' THEN ev:='lead_created'; ELSIF NEW.status IS DISTINCT FROM OLD.status THEN ev:='status_changed'; ELSE RETURN NEW; END IF;
 FOR r IN SELECT * FROM public.automation_rules WHERE organization_id=NEW.organization_id AND active AND trigger_event=ev AND (match_status='' OR match_status=NEW.status) LOOP
  IF r.action='create_task' THEN
   INSERT INTO public.tasks(organization_id,owner_id,lead_id,title,due_at,priority) VALUES(NEW.organization_id,coalesce(NEW.assigned_to,NEW.owner_id),NEW.id,left(coalesce(nullif(r.task_title,''),r.name)||': '||NEW.name,200),now()+make_interval(days=>r.due_days),'Medium');
  ELSIF r.action='set_label' AND r.label<>'' THEN
   UPDATE public.leads SET label=r.label WHERE id=NEW.id AND label<>r.label;
  END IF;
  UPDATE public.automation_rules SET runs=runs+1 WHERE id=r.id;
 END LOOP; RETURN NEW; END $$;
CREATE TRIGGER crm_lead_automations AFTER INSERT OR UPDATE OF status ON public.leads FOR EACH ROW EXECUTE FUNCTION public.crm_run_automations();