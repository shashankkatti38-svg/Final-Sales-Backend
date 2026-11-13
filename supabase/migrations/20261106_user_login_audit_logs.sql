-- 20261106_user_login_audit_logs.sql
-- User Login Audit Logging & Attendance Status Tracking for Admin Panel

CREATE TABLE IF NOT EXISTS public.user_login_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  email text,
  name text,
  role text,
  organization_id text,
  organization_name text,
  action text NOT NULL DEFAULT 'LOGIN',
  status text NOT NULL DEFAULT 'SUCCESS',
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_login_audit_logs_user_id ON public.user_login_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_login_audit_logs_created_at ON public.user_login_audit_logs(created_at DESC);

ALTER TABLE public.user_login_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access to user_login_audit_logs" ON public.user_login_audit_logs;
CREATE POLICY "Allow read access to user_login_audit_logs" ON public.user_login_audit_logs
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert to user_login_audit_logs" ON public.user_login_audit_logs;
CREATE POLICY "Allow insert to user_login_audit_logs" ON public.user_login_audit_logs
  FOR INSERT WITH CHECK (true);

-- RPC to retrieve all users with their live login status (Logged in vs Never logged in)
CREATE OR REPLACE FUNCTION public.get_user_login_audit_summary()
RETURNS TABLE (
  user_id text,
  email text,
  name text,
  role text,
  organization_id text,
  organization_name text,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  has_logged_in boolean,
  login_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id::text AS user_id,
    u.email::text AS email,
    COALESCE(NULLIF(TRIM(p.display_name), ''), NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''), NULLIF(TRIM(u.raw_user_meta_data->>'name'), ''), split_part(u.email::text, '@', 1)) AS name,
    COALESCE(r.role, 'User') AS role,
    o.id AS organization_id,
    COALESCE(o.name, 'SalesWorks 360 Enterprise') AS organization_name,
    u.last_sign_in_at,
    u.created_at,
    (u.last_sign_in_at IS NOT NULL) AS has_logged_in,
    COALESCE((
      SELECT count(*) FROM public.user_login_audit_logs l WHERE l.user_id = u.id::text
    ), CASE WHEN u.last_sign_in_at IS NOT NULL THEN 1 ELSE 0 END) AS login_count
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id::text
  LEFT JOIN public.user_roles r ON r.user_id = u.id::text
  LEFT JOIN public.organizations o ON o.id = r.organization_id
  ORDER BY u.last_sign_in_at DESC NULLS LAST, u.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_login_audit_summary() TO authenticated, anon;

-- RPC to record a login audit entry
CREATE OR REPLACE FUNCTION public.record_user_login_audit(
  p_user_id text,
  p_email text DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_org_id text DEFAULT NULL,
  p_org_name text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_ip text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.user_login_audit_logs (
    user_id, email, name, role, organization_id, organization_name, action, status, user_agent, ip_address, created_at
  ) VALUES (
    p_user_id, p_email, p_name, p_role, p_org_id, p_org_name, 'LOGIN', 'SUCCESS', p_user_agent, p_ip, now()
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_user_login_audit TO authenticated, anon;

