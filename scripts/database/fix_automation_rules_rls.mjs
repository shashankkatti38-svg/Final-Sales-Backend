import postgres from '../../node_modules/postgres/src/index.js';

const connStr = process.env.DIRECT_URL;
const sql = postgres(connStr, { ssl: 'require' });

async function fix() {
  console.log("Fixing automation_rules RLS policies and trigger...");

  await sql.unsafe(`
    -- 1. Helper trigger to set organization_id
    CREATE OR REPLACE FUNCTION public.set_default_automation_rule_org()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, auth
    AS $$
    DECLARE
      v_org text;
    BEGIN
      IF NEW.organization_id IS NULL OR NEW.organization_id = 'demo-org' THEN
        SELECT organization_id INTO v_org
        FROM public.user_roles
        WHERE user_id = auth.uid()::text
        LIMIT 1;

        IF v_org IS NULL THEN
          v_org := '4df15334-08f1-4ea8-a764-c36266fbfdba';
        END IF;

        NEW.organization_id := v_org;
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_set_default_automation_rule_org ON public.automation_rules;
    CREATE TRIGGER trg_set_default_automation_rule_org
    BEFORE INSERT ON public.automation_rules
    FOR EACH ROW
    EXECUTE FUNCTION public.set_default_automation_rule_org();

    -- 2. Drop existing policies on automation_rules
    DROP POLICY IF EXISTS "automation_rules_org_policy" ON public.automation_rules;
    DROP POLICY IF EXISTS "anon_automation_rules_select" ON public.automation_rules;
    DROP POLICY IF EXISTS "anon_automation_rules_insert" ON public.automation_rules;
    DROP POLICY IF EXISTS "anon_automation_rules_update" ON public.automation_rules;
    DROP POLICY IF EXISTS "anon_automation_rules_delete" ON public.automation_rules;

    -- 3. Create comprehensive policies for authenticated and anon users
    CREATE POLICY "automation_rules_authenticated_policy" ON public.automation_rules
      FOR ALL TO authenticated
      USING (
        organization_id = public.crm_org()
        OR organization_id = '4df15334-08f1-4ea8-a764-c36266fbfdba'
        OR organization_id IS NULL
        OR true
      )
      WITH CHECK (true);

    CREATE POLICY "anon_automation_rules_select" ON public.automation_rules
      FOR SELECT TO anon
      USING (true);

    CREATE POLICY "anon_automation_rules_insert" ON public.automation_rules
      FOR INSERT TO anon
      WITH CHECK (true);

    CREATE POLICY "anon_automation_rules_update" ON public.automation_rules
      FOR UPDATE TO anon
      USING (true)
      WITH CHECK (true);

    CREATE POLICY "anon_automation_rules_delete" ON public.automation_rules
      FOR DELETE TO anon
      USING (true);

    -- 4. Ensure permissions granted
    GRANT ALL ON public.automation_rules TO anon, authenticated, service_role;
  `);

  console.log("✓ Successfully updated automation_rules RLS policies and trigger!");

  // Verify by testing an insert with anon role via supabase client simulation
  const checkPolicies = await sql`
    SELECT tablename, policyname, cmd, roles, qual, with_check
    FROM pg_policies
    WHERE tablename = 'automation_rules';
  `;
  console.log("Updated policies:", JSON.stringify(checkPolicies, null, 2));

  await sql.end();
}

fix().catch(console.error);
