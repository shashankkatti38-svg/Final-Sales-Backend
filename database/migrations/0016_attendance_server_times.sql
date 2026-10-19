CREATE OR REPLACE FUNCTION public.attendance_server_time() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.check_in := now(); NEW.check_out := NULL; END IF;
 IF TG_OP='UPDATE' THEN
  NEW.check_in := OLD.check_in;
  IF OLD.check_out IS NOT NULL THEN NEW.check_out := OLD.check_out;
  ELSIF NEW.check_out IS NOT NULL THEN NEW.check_out := now(); END IF;
 END IF;
 RETURN NEW; END $$;
CREATE TRIGGER attendance_server_time BEFORE INSERT OR UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.attendance_server_time();