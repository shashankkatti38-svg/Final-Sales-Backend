import postgres from '../../node_modules/postgres/src/index.js';
const connStr = process.env.DIRECT_URL;
const sql = postgres(connStr, { ssl: 'require' });

async function apply() {
  console.log("Applying remaining CRM policies for complete app functionality...");

  await sql.unsafe(`
    -- Activities
    DROP POLICY IF EXISTS "activities_org_policy" ON public.activities;
    CREATE POLICY "activities_org_policy" ON public.activities
      FOR ALL TO authenticated
      USING (organization_id = public.crm_org())
      WITH CHECK (organization_id = public.crm_org());
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.activities TO authenticated;

    -- Tasks
    DROP POLICY IF EXISTS "tasks_org_policy" ON public.tasks;
    CREATE POLICY "tasks_org_policy" ON public.tasks
      FOR ALL TO authenticated
      USING (organization_id = public.crm_org())
      WITH CHECK (organization_id = public.crm_org());
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;

    -- Products
    DROP POLICY IF EXISTS "products_org_policy" ON public.products;
    CREATE POLICY "products_org_policy" ON public.products
      FOR ALL TO authenticated
      USING (organization_id = public.crm_org() OR organization_id IS NULL)
      WITH CHECK (organization_id = public.crm_org());
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;

    -- Content Pages
    DROP POLICY IF EXISTS "content_pages_org_policy" ON public.content_pages;
    CREATE POLICY "content_pages_org_policy" ON public.content_pages
      FOR ALL TO authenticated
      USING (true);
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_pages TO authenticated;

    -- Call Logs
    DROP POLICY IF EXISTS "call_logs_org_policy" ON public.call_logs;
    CREATE POLICY "call_logs_org_policy" ON public.call_logs
      FOR ALL TO authenticated
      USING (organization_id = public.crm_org() OR owner_id = auth.uid()::text);
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_logs TO authenticated;

    -- Sales Documents
    DROP POLICY IF EXISTS "sales_documents_org_policy" ON public.sales_documents;
    CREATE POLICY "sales_documents_org_policy" ON public.sales_documents
      FOR ALL TO authenticated
      USING (organization_id = public.crm_org())
      WITH CHECK (organization_id = public.crm_org());
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_documents TO authenticated;

    -- Payments
    DROP POLICY IF EXISTS "payments_org_policy" ON public.payments;
    CREATE POLICY "payments_org_policy" ON public.payments
      FOR ALL TO authenticated
      USING (true);
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;

    -- Attendance
    DROP POLICY IF EXISTS "attendance_org_policy" ON public.attendance;
    CREATE POLICY "attendance_org_policy" ON public.attendance
      FOR ALL TO authenticated
      USING (organization_id = public.crm_org() OR owner_id = auth.uid()::text)
      WITH CHECK (organization_id = public.crm_org() AND owner_id = auth.uid()::text);
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance TO authenticated;

    -- Sales Targets
    DROP POLICY IF EXISTS "sales_targets_org_policy" ON public.sales_targets;
    CREATE POLICY "sales_targets_org_policy" ON public.sales_targets
      FOR ALL TO authenticated
      USING (organization_id = public.crm_org());
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_targets TO authenticated;

    -- Automation Rules
    DROP POLICY IF EXISTS "automation_rules_org_policy" ON public.automation_rules;
    CREATE POLICY "automation_rules_org_policy" ON public.automation_rules
      FOR ALL TO authenticated
      USING (organization_id = public.crm_org());
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_rules TO authenticated;
  `);

  console.log("✓ All remaining CRM table policies applied successfully!");
  await sql.end();
}

apply().catch(console.error);
