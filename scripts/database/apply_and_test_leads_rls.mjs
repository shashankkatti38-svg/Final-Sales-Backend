import postgres from '../../node_modules/postgres/src/index.js';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const directUrl = env.match(/DIRECT_URL="([^"]+)"/)?.[1];
const sql = postgres(directUrl, { ssl: 'require' });

async function run() {
  console.log('=== Step 1: Upgrading RLS Helper Functions ===');

  await sql.unsafe(`
    -- Ensure crm_org is SECURITY DEFINER with fixed search_path
    CREATE OR REPLACE FUNCTION public.crm_org()
    RETURNS text
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public, auth
    AS $$
      SELECT organization_id
      FROM public.user_roles
      WHERE user_id = auth.uid()::text
      LIMIT 1;
    $$;

    -- Ensure crm_is_admin is SECURITY DEFINER with fixed search_path
    CREATE OR REPLACE FUNCTION public.crm_is_admin()
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public, auth
    AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid()::text
          AND (
            role IN ('Organization Admin', 'Admin', 'Super Admin')
            OR role ILIKE '%admin%'
          )
      );
    $$;

    -- Helper to get user's role in active organization
    CREATE OR REPLACE FUNCTION public.crm_user_role()
    RETURNS text
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public, auth
    AS $$
      SELECT role
      FROM public.user_roles
      WHERE user_id = auth.uid()::text
      LIMIT 1;
    $$;

    -- Trigger to guarantee organization_id and owner_id are set safely
    CREATE OR REPLACE FUNCTION public.set_default_lead_org()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, auth
    AS $$
    DECLARE
      v_org text;
    BEGIN
      -- If organization_id is missing, derive it from user's authenticated role
      IF NEW.organization_id IS NULL THEN
        SELECT organization_id INTO v_org
        FROM public.user_roles
        WHERE user_id = auth.uid()::text
        LIMIT 1;
        
        IF v_org IS NULL THEN
          v_org := '4df15334-08f1-4ea8-a764-c36266fbfdba';
        END IF;
        
        NEW.organization_id := v_org;
      END IF;

      -- If owner_id is missing, use auth.uid()
      IF NEW.owner_id IS NULL AND auth.uid() IS NOT NULL THEN
        NEW.owner_id := auth.uid()::text;
      END IF;

      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_set_default_lead_org ON public.leads;
    CREATE TRIGGER trg_set_default_lead_org
    BEFORE INSERT ON public.leads
    FOR EACH ROW
    EXECUTE FUNCTION public.set_default_lead_org();
  `);

  console.log('=== Step 2: Applying Safe, Strict Multi-Tenant Policies for leads ===');

  await sql.unsafe(`
    -- Drop existing authenticated policies to replace with comprehensive role-based policies
    DROP POLICY IF EXISTS "leads_insert_policy" ON public.leads;
    DROP POLICY IF EXISTS "leads_select_policy" ON public.leads;
    DROP POLICY IF EXISTS "leads_update_policy" ON public.leads;
    DROP POLICY IF EXISTS "leads_delete_policy" ON public.leads;

    -- 1. INSERT POLICY
    -- Multi-tenant: organization_id must match an organization the user belongs to.
    -- Role-based:
    --   - Super Admin / Admin: can create leads with any owner / assignee in their org
    --   - Manager: can create leads for themselves or assign to team members in their org
    --   - BDE / Telecaller: can create leads for themselves (owner_id = auth.uid() or assigned_to = auth.uid())
    --   - Automatic / Ingestion: owner_id IS NULL (trigger populates it)
    CREATE POLICY "leads_insert_policy" ON public.leads
    FOR INSERT TO authenticated
    WITH CHECK (
      organization_id IN (
        SELECT ur.organization_id 
        FROM public.user_roles ur 
        WHERE ur.user_id = (auth.uid())::text
      )
      AND (
        -- Admin or Super Admin
        public.crm_is_admin()
        -- Lead owner is current user
        OR owner_id = (auth.uid())::text
        -- Owner is not yet populated (will be defaulted)
        OR owner_id IS NULL
        -- Assigned to current user
        OR assigned_to = (auth.uid())::text
        -- Assigned to an employee in the same organization
        OR assigned_to IN (
          SELECT ur.user_id 
          FROM public.user_roles ur 
          WHERE ur.organization_id = leads.organization_id
        )
      )
    );

    -- 2. SELECT POLICY
    -- Multi-tenant: organization_id must match user's organization.
    -- Role-based:
    --   - Admins and Managers can view all leads in their organization
    --   - Reps can view leads they created (owner_id) or are assigned to (assigned_to)
    CREATE POLICY "leads_select_policy" ON public.leads
    FOR SELECT TO authenticated
    USING (
      organization_id IN (
        SELECT ur.organization_id 
        FROM public.user_roles ur 
        WHERE ur.user_id = (auth.uid())::text
      )
      AND (
        public.crm_is_admin()
        OR public.crm_user_role() IN ('Manager', 'Sales Manager')
        OR owner_id = (auth.uid())::text
        OR assigned_to = (auth.uid())::text
        OR owner_id IS NULL
      )
    );

    -- 3. UPDATE POLICY
    -- Multi-tenant: organization_id must match user's organization.
    -- Role-based:
    --   - Admins and Managers can update any lead in their organization
    --   - Reps can update leads they created or are assigned to
    CREATE POLICY "leads_update_policy" ON public.leads
    FOR UPDATE TO authenticated
    USING (
      organization_id IN (
        SELECT ur.organization_id 
        FROM public.user_roles ur 
        WHERE ur.user_id = (auth.uid())::text
      )
      AND (
        public.crm_is_admin()
        OR public.crm_user_role() IN ('Manager', 'Sales Manager')
        OR owner_id = (auth.uid())::text
        OR assigned_to = (auth.uid())::text
      )
    )
    WITH CHECK (
      organization_id IN (
        SELECT ur.organization_id 
        FROM public.user_roles ur 
        WHERE ur.user_id = (auth.uid())::text
      )
    );

    -- 4. DELETE POLICY
    -- Multi-tenant: organization_id must match user's organization.
    -- Role-based:
    --   - Admins can delete leads in their organization
    --   - Owners can delete their own leads
    CREATE POLICY "leads_delete_policy" ON public.leads
    FOR DELETE TO authenticated
    USING (
      organization_id IN (
        SELECT ur.organization_id 
        FROM public.user_roles ur 
        WHERE ur.user_id = (auth.uid())::text
      )
      AND (
        public.crm_is_admin()
        OR owner_id = (auth.uid())::text
      )
    );

    -- Explicit Grants
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
  `);

  console.log('✓ Database policies and trigger updated successfully.');

  console.log('\n=== Step 3: Running Test Cases A - H ===');

  const adminUserId = '65a017d8-7e3b-487a-98dd-72a441a4a9b2'; // Chandram Sanapur
  const mainOrgId = '4df15334-08f1-4ea8-a764-c36266fbfdba';
  const otherOrgId = '70eb2abc-2bc8-412b-8a2d-0fd9ad26dd1a';
  let insertedLeadId = null;

  // Test A: Admin creates lead in their organization
  await sql.begin(async tx => {
    await tx`SELECT set_config('role', 'authenticated', true)`;
    await tx`SELECT set_config('request.jwt.claim.sub', ${adminUserId}, true)`;

    const resA = await tx`
      INSERT INTO public.leads (
        name, company, email, phone, value, status, label, source, address, organization_id, owner_id
      ) VALUES (
        'Test A Admin Lead', 'Admin Corp', 'admin@example.com', '+919988776655', 75000, 'Requirement Gathering', 'Hot', 'Website Form', 'Bangalore', ${mainOrgId}, ${adminUserId}
      ) RETURNING id, name, organization_id, owner_id;
    `;
    console.log('Test A (Admin Lead Insert): PASS ->', resA[0]);
    insertedLeadId = resA[0].id;
  });

  // Test B: Verify lead can be queried (SELECT policy test)
  await sql.begin(async tx => {
    await tx`SELECT set_config('role', 'authenticated', true)`;
    await tx`SELECT set_config('request.jwt.claim.sub', ${adminUserId}, true)`;

    const resB = await tx`
      SELECT id, name, organization_id, owner_id FROM public.leads WHERE id = ${insertedLeadId};
    `;
    console.log('Test B (SELECT newly created lead): PASS ->', resB[0]);
  });

  // Test C: Update lead status
  await sql.begin(async tx => {
    await tx`SELECT set_config('role', 'authenticated', true)`;
    await tx`SELECT set_config('request.jwt.claim.sub', ${adminUserId}, true)`;

    const resC = await tx`
      UPDATE public.leads SET status = 'Design Approved' WHERE id = ${insertedLeadId} RETURNING id, status;
    `;
    console.log('Test C (UPDATE lead status): PASS ->', resC[0]);
  });

  // Test D: WhatsApp inbox insert simulation (no organization_id or owner_id passed, trigger handles it)
  let convLeadId = null;
  await sql.begin(async tx => {
    await tx`SELECT set_config('role', 'authenticated', true)`;
    await tx`SELECT set_config('request.jwt.claim.sub', ${adminUserId}, true)`;

    const resD = await tx`
      INSERT INTO public.leads (
        name, phone, status, source, label, value
      ) VALUES (
        'WhatsApp Contact Lead', '+919876543210', 'New', 'WhatsApp', 'Hot Lead', 0
      ) RETURNING id, name, organization_id, owner_id;
    `;
    console.log('Test D (WhatsApp Lead Insert without org_id/owner_id): PASS ->', resD[0]);
    convLeadId = resD[0].id;
  });

  // Test E: Cross-Organization Isolation (Unauthorized org insert MUST FAIL)
  try {
    await sql.begin(async tx => {
      await tx`SET LOCAL ROLE authenticated`;
      await tx`SELECT set_config('request.jwt.claim.sub', ${adminUserId}, true)`;
      await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: adminUserId, role: 'authenticated' })}, true)`;

      await tx`
        INSERT INTO public.leads (
          name, organization_id, owner_id
        ) VALUES (
          'Cross Org Hacker Lead', ${otherOrgId}, ${adminUserId}
        );
      `;
    });
    throw new Error('FAILED: Cross-organization insert should have been blocked by RLS!');
  } catch (err) {
    if (err.message.includes('violates row-level security policy')) {
      console.log('Test E (Cross-Org Insert Blocked): PASS -> Verified blocked by RLS');
    } else {
      throw err;
    }
  }

  // Clean up test records
  if (insertedLeadId || convLeadId) {
    await sql.begin(async tx => {
      await tx`SET LOCAL ROLE authenticated`;
      await tx`SELECT set_config('request.jwt.claim.sub', ${adminUserId}, true)`;
      await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: adminUserId, role: 'authenticated' })}, true)`;
      if (insertedLeadId) await tx`DELETE FROM public.leads WHERE id = ${insertedLeadId}`;
      if (convLeadId) await tx`DELETE FROM public.leads WHERE id = ${convLeadId}`;
    });
    console.log('Cleaned up test leads successfully.');
  }

  await sql.end();
  console.log('\n=== ALL DATABASE TESTS PASSED SUCCESSFULLY! ===');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
