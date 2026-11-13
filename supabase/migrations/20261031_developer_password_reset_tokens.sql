-- Developer-only password reset tokens (hashed). Service/DIRECT_URL access only.
CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  request_ip text,
  user_agent text
);

CREATE TABLE IF NOT EXISTS public.password_reset_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
  ON public.password_reset_tokens (user_id);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
  ON public.password_reset_tokens (expires_at);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_unused
  ON public.password_reset_tokens (user_id)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_password_reset_rate_limits_bucket_created
  ON public.password_reset_rate_limits (bucket_key, created_at);

ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_rate_limits ENABLE ROW LEVEL SECURITY;

-- No policies: clients cannot read/write via PostgREST. Server uses DIRECT_URL.
REVOKE ALL ON public.password_reset_tokens FROM anon, authenticated;
REVOKE ALL ON public.password_reset_rate_limits FROM anon, authenticated;
