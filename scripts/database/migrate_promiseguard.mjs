import fs from 'fs'
import postgres from '../../node_modules/postgres/src/index.js'

const envContent = fs.readFileSync('.env', 'utf8')
const m = envContent.match(/DIRECT_URL=["']([^"']+)["']/)
if (!m) {
  console.error("DIRECT_URL missing")
  process.exit(1)
}

const sql = postgres(m[1], { ssl: 'require' })

async function run() {
  console.log("Applying PromiseGuard AI Migration...")

  // 1. Create promiseguard_commitments table
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS public.promiseguard_commitments (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      organization_id text NOT NULL DEFAULT public.crm_org(),
      lead_id text REFERENCES public.leads(id) ON DELETE SET NULL,
      contact_id text,
      deal_id text,
      call_id text REFERENCES public.call_logs(id) ON DELETE SET NULL,
      assigned_employee_id text REFERENCES public.profiles(id) ON DELETE SET NULL,
      created_by text DEFAULT auth.uid()::text,
      commitment_text text NOT NULL,
      commitment_type text NOT NULL DEFAULT 'custom',
      source_type text NOT NULL DEFAULT 'manual',
      source_reference_id text,
      source_excerpt text,
      due_at timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      confidence_score numeric DEFAULT 1.0,
      review_status text NOT NULL DEFAULT 'confirmed',
      fulfilled_at timestamptz,
      fulfilled_by text,
      evidence_summary text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      CONSTRAINT valid_status CHECK (status IN ('pending', 'verified', 'needs_verification', 'fulfilled', 'overdue', 'cancelled', 'rejected')),
      CONSTRAINT valid_review CHECK (review_status IN ('pending_review', 'confirmed', 'rejected'))
    );

    CREATE INDEX IF NOT EXISTS idx_pg_commitments_org ON public.promiseguard_commitments(organization_id);
    CREATE INDEX IF NOT EXISTS idx_pg_commitments_lead ON public.promiseguard_commitments(lead_id);
    CREATE INDEX IF NOT EXISTS idx_pg_commitments_assigned ON public.promiseguard_commitments(assigned_employee_id);
    CREATE INDEX IF NOT EXISTS idx_pg_commitments_status ON public.promiseguard_commitments(status);
    CREATE INDEX IF NOT EXISTS idx_pg_commitments_due ON public.promiseguard_commitments(due_at);
  `)
  console.log("✓ Created promiseguard_commitments")

  // 2. Create promiseguard_evidence table
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS public.promiseguard_evidence (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      commitment_id text NOT NULL REFERENCES public.promiseguard_commitments(id) ON DELETE CASCADE,
      organization_id text NOT NULL DEFAULT public.crm_org(),
      evidence_type text NOT NULL,
      source_reference_id text,
      verification_status text NOT NULL DEFAULT 'verified',
      verified_at timestamptz DEFAULT now(),
      verified_by text DEFAULT auth.uid()::text,
      notes text,
      created_at timestamptz DEFAULT now(),
      CONSTRAINT valid_evidence_status CHECK (verification_status IN ('pending', 'verified', 'needs_verification', 'rejected'))
    );

    CREATE INDEX IF NOT EXISTS idx_pg_evidence_commitment ON public.promiseguard_evidence(commitment_id);
    CREATE INDEX IF NOT EXISTS idx_pg_evidence_org ON public.promiseguard_evidence(organization_id);
  `)
  console.log("✓ Created promiseguard_evidence")

  // 3. Create promiseguard_notifications table
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS public.promiseguard_notifications (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      commitment_id text NOT NULL REFERENCES public.promiseguard_commitments(id) ON DELETE CASCADE,
      organization_id text NOT NULL DEFAULT public.crm_org(),
      recipient_id text NOT NULL,
      notification_type text NOT NULL,
      scheduled_at timestamptz NOT NULL,
      delivered_at timestamptz,
      delivery_status text NOT NULL DEFAULT 'scheduled',
      created_at timestamptz DEFAULT now(),
      CONSTRAINT valid_delivery_status CHECK (delivery_status IN ('scheduled', 'delivered', 'failed', 'dismissed'))
    );

    CREATE INDEX IF NOT EXISTS idx_pg_notifications_commit ON public.promiseguard_notifications(commitment_id);
    CREATE INDEX IF NOT EXISTS idx_pg_notifications_recip ON public.promiseguard_notifications(recipient_id);
    CREATE INDEX IF NOT EXISTS idx_pg_notifications_sched ON public.promiseguard_notifications(scheduled_at);
  `)
  console.log("✓ Created promiseguard_notifications")

  // 4. Create promiseguard_audit_logs table
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS public.promiseguard_audit_logs (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      organization_id text NOT NULL DEFAULT public.crm_org(),
      commitment_id text NOT NULL REFERENCES public.promiseguard_commitments(id) ON DELETE CASCADE,
      actor_id text DEFAULT auth.uid()::text,
      action text NOT NULL,
      old_value jsonb,
      new_value jsonb,
      created_at timestamptz DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_pg_audit_commitment ON public.promiseguard_audit_logs(commitment_id);
    CREATE INDEX IF NOT EXISTS idx_pg_audit_org ON public.promiseguard_audit_logs(organization_id);
  `)
  console.log("✓ Created promiseguard_audit_logs")

  // 5. Enable Row Level Security and add Tenant Policies
  await sql.unsafe(`
    ALTER TABLE public.promiseguard_commitments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.promiseguard_evidence ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.promiseguard_notifications ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.promiseguard_audit_logs ENABLE ROW LEVEL SECURITY;

    -- Commitments RLS
    DROP POLICY IF EXISTS "pg_commitments_select" ON public.promiseguard_commitments;
    DROP POLICY IF EXISTS "pg_commitments_insert" ON public.promiseguard_commitments;
    DROP POLICY IF EXISTS "pg_commitments_update" ON public.promiseguard_commitments;
    DROP POLICY IF EXISTS "pg_commitments_delete" ON public.promiseguard_commitments;

    CREATE POLICY "pg_commitments_select" ON public.promiseguard_commitments
      FOR SELECT TO authenticated
      USING (organization_id = public.crm_org());

    CREATE POLICY "pg_commitments_insert" ON public.promiseguard_commitments
      FOR INSERT TO authenticated
      WITH CHECK (organization_id = public.crm_org());

    CREATE POLICY "pg_commitments_update" ON public.promiseguard_commitments
      FOR UPDATE TO authenticated
      USING (organization_id = public.crm_org())
      WITH CHECK (organization_id = public.crm_org());

    CREATE POLICY "pg_commitments_delete" ON public.promiseguard_commitments
      FOR DELETE TO authenticated
      USING (organization_id = public.crm_org() AND public.crm_is_admin());

    -- Evidence RLS
    DROP POLICY IF EXISTS "pg_evidence_select" ON public.promiseguard_evidence;
    DROP POLICY IF EXISTS "pg_evidence_insert" ON public.promiseguard_evidence;
    DROP POLICY IF EXISTS "pg_evidence_update" ON public.promiseguard_evidence;

    CREATE POLICY "pg_evidence_select" ON public.promiseguard_evidence
      FOR SELECT TO authenticated
      USING (organization_id = public.crm_org());

    CREATE POLICY "pg_evidence_insert" ON public.promiseguard_evidence
      FOR INSERT TO authenticated
      WITH CHECK (organization_id = public.crm_org());

    CREATE POLICY "pg_evidence_update" ON public.promiseguard_evidence
      FOR UPDATE TO authenticated
      USING (organization_id = public.crm_org());

    -- Notifications RLS
    DROP POLICY IF EXISTS "pg_notifications_select" ON public.promiseguard_notifications;
    DROP POLICY IF EXISTS "pg_notifications_insert" ON public.promiseguard_notifications;
    DROP POLICY IF EXISTS "pg_notifications_update" ON public.promiseguard_notifications;

    CREATE POLICY "pg_notifications_select" ON public.promiseguard_notifications
      FOR SELECT TO authenticated
      USING (organization_id = public.crm_org());

    CREATE POLICY "pg_notifications_insert" ON public.promiseguard_notifications
      FOR INSERT TO authenticated
      WITH CHECK (organization_id = public.crm_org());

    CREATE POLICY "pg_notifications_update" ON public.promiseguard_notifications
      FOR UPDATE TO authenticated
      USING (organization_id = public.crm_org());

    -- Audit Logs RLS
    DROP POLICY IF EXISTS "pg_audit_select" ON public.promiseguard_audit_logs;
    DROP POLICY IF EXISTS "pg_audit_insert" ON public.promiseguard_audit_logs;

    CREATE POLICY "pg_audit_select" ON public.promiseguard_audit_logs
      FOR SELECT TO authenticated
      USING (organization_id = public.crm_org());

    CREATE POLICY "pg_audit_insert" ON public.promiseguard_audit_logs
      FOR INSERT TO authenticated
      WITH CHECK (organization_id = public.crm_org());

    -- Grants
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.promiseguard_commitments TO authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.promiseguard_evidence TO authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.promiseguard_notifications TO authenticated, service_role;
    GRANT SELECT, INSERT ON public.promiseguard_audit_logs TO authenticated, service_role;
  `)
  console.log("✓ Applied Row Level Security policies and grants")

  // 6. Verification & Trigger for automated overdue detection
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION public.promiseguard_update_overdue()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    BEGIN
      IF NEW.status = 'pending' AND NEW.due_at < now() THEN
        NEW.status := 'overdue';
      END IF;
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_pg_commitments_overdue ON public.promiseguard_commitments;
    CREATE TRIGGER trg_pg_commitments_overdue
      BEFORE INSERT OR UPDATE ON public.promiseguard_commitments
      FOR EACH ROW
      EXECUTE FUNCTION public.promiseguard_update_overdue();
  `)
  console.log("✓ Trigger for overdue commitments registered")

  console.log("Migration complete!")
  await sql.end()
}

run().catch(err => {
  console.error("Migration error:", err)
  process.exit(1)
})
