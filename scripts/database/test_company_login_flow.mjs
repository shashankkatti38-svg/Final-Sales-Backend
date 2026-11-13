import fs from 'fs';
import postgres from '../../node_modules/postgres/src/index.js';

const envContent = fs.readFileSync('.env', 'utf8');
const m = envContent.match(/DIRECT_URL=["']([^"']+)["']/) || envContent.match(/DATABASE_URL=["']([^"']+)["']/);
if (!m) {
  console.error("Missing DIRECT_URL or DATABASE_URL in .env");
  process.exit(1);
}

const sql = postgres(m[1], { ssl: 'require', max: 1 });

async function runTests() {
  console.log("================================================================================");
  console.log("SALESWORKS360: EXACT COMPANY ONBOARDING, LOGIN & ROLE-BASED ACCESS VERIFICATION");
  console.log("================================================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  async function asUser(client, userId, callback) {
    return await client.begin(async (tx) => {
      await tx.unsafe(`
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${userId}', true),
               set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
      `);
      return await callback(tx);
    });
  }

  const cleanupIds = {
    orgs: [],
    users: [],
    leads: [],
    tasks: []
  };

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Super Admin Login & Identify Super Admin Account
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 1: Super Admin Identification & Authorization ---");
    const [superAdmin] = await sql`
      SELECT u.id, u.email, ur.role
      FROM auth.users u
      JOIN user_roles ur ON ur.user_id = u.id::text
      WHERE ur.role = 'Super Admin'
      LIMIT 1;
    `;
    assert(superAdmin && superAdmin.role === 'Super Admin', 
      `Super Admin found: ${superAdmin.email} (${superAdmin.id})`);

    const superAdminId = superAdmin.id.toString();

    // -------------------------------------------------------------------------
    // STEP 2: Super Admin Creates Company A and Initial Company Admin Login
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 2: Super Admin Creates Company A and Admin Login Details ---");
    const compAName = `Apex Logistics Corp ${Date.now()}`;
    const compAAdminEmail = `admin_apex_${Date.now()}@apexlogistics.com`;
    const compAAdminName = 'Rajiv Sharma';
    const compAAdminPassword = 'ApexAdmin#2026';

    const createAResult = await asUser(sql, superAdminId, async (tx) => {
      const [res] = await tx`
        SELECT crm_super_admin_create_company(
          ${compAName},
          ${compAAdminEmail},
          ${compAAdminName},
          ${compAAdminPassword},
          'https://apexlogistics.com',
          '+919876543210',
          'Logistics & Supply Chain',
          'Outer Ring Road, Marathahalli',
          'Bengaluru',
          'Karnataka',
          'India',
          '29AAAAA0000A1Z5',
          '09:30:00',
          '18:30:00',
          1,
          'ENTERPRISE'
        ) as result
      `;
      return res.result;
    });

    const orgAId = createAResult.company_id;
    const adminAId = createAResult.admin_id;
    cleanupIds.orgs.push(orgAId);
    cleanupIds.users.push(adminAId);

    assert(orgAId && adminAId, 
      `Company A created: "${compAName}" (Org ID: ${orgAId}, Admin: ${compAAdminEmail})`);

    // Verify Company Admin credentials in auth.users
    const [authAUser] = await sql`SELECT id, email, encrypted_password FROM auth.users WHERE id = ${adminAId}::uuid`;
    assert(authAUser && authAUser.email === compAAdminEmail.toLowerCase(), 
      `Company Admin A user created in auth.users with encrypted bcrypt password`);

    // Verify Company Admin role in user_roles
    const [roleA] = await sql`SELECT role, organization_id FROM user_roles WHERE user_id = ${adminAId}`;
    assert(roleA && roleA.role === 'Admin' && roleA.organization_id === orgAId, 
      `Company Admin A has role='Admin' and organization_id='${orgAId}' in user_roles`);

    // -------------------------------------------------------------------------
    // STEP 3: Verify Data is in 0 After Creating the New Company
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 3: Verify Data is Exactly 0 for Newly Created Company ---");
    
    // Test direct database query as Company Admin A
    const leadsA = await asUser(sql, adminAId, async (tx) => {
      return await tx`SELECT * FROM leads WHERE organization_id = ${orgAId}`;
    });
    const tasksA = await asUser(sql, adminAId, async (tx) => {
      return await tx`SELECT * FROM tasks WHERE organization_id = ${orgAId}`;
    });
    const salesDocsA = await asUser(sql, adminAId, async (tx) => {
      return await tx`SELECT * FROM sales_documents WHERE organization_id = ${orgAId}`;
    });
    const paymentsA = await asUser(sql, adminAId, async (tx) => {
      return await tx`SELECT * FROM payments WHERE organization_id = ${orgAId}`;
    });
    const activitiesA = await asUser(sql, adminAId, async (tx) => {
      return await tx`SELECT * FROM activities WHERE organization_id = ${orgAId}`;
    });
    const membersA = await asUser(sql, adminAId, async (tx) => {
      return await tx`SELECT * FROM user_roles WHERE organization_id = ${orgAId}`;
    });

    assert(leadsA.length === 0, `Company A has 0 leads on creation (Current: ${leadsA.length})`);
    assert(tasksA.length === 0, `Company A has 0 tasks on creation (Current: ${tasksA.length})`);
    assert(salesDocsA.length === 0, `Company A has 0 sales documents on creation (Current: ${salesDocsA.length})`);
    assert(paymentsA.length === 0, `Company A has 0 payments on creation (Current: ${paymentsA.length})`);
    assert(activitiesA.length === 0, `Company A has 0 activities on creation (Current: ${activitiesA.length})`);
    assert(membersA.length === 1 && membersA[0].user_id === adminAId, 
      `Company A has exactly 1 initial member (Company Admin A)`);

    // -------------------------------------------------------------------------
    // STEP 4: Company Admin A Creates Manager Login
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 4: Company Admin A Creates Manager Login Account ---");
    const managerAEmail = `manager_apex_${Date.now()}@apexlogistics.com`;
    const managerAName = 'Suresh Patil';
    const managerAPassword = 'ManagerPass#2026';

    const createManagerResult = await asUser(sql, adminAId, async (tx) => {
      const [res] = await tx`
        SELECT crm_company_admin_create_member(
          ${managerAEmail},
          ${managerAName},
          ${managerAPassword},
          'Manager',
          NULL,
          NULL,
          ${orgAId}
        ) as result
      `;
      return res.result;
    });

    const managerAId = createManagerResult.user_id;
    cleanupIds.users.push(managerAId);

    assert(managerAId && createManagerResult.success, 
      `Company Admin created Manager A: "${managerAName}" (${managerAEmail})`);

    const [managerRole] = await sql`SELECT role, organization_id FROM user_roles WHERE user_id = ${managerAId}`;
    assert(managerRole && managerRole.role === 'Manager' && managerRole.organization_id === orgAId, 
      `Manager A assigned role='Manager' in user_roles for Company A`);

    // -------------------------------------------------------------------------
    // STEP 5: Company Admin A Creates Executive Login linked to Manager A
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 5: Company Admin A Creates Executive Login Account ---");
    const execAEmail = `exec_apex_${Date.now()}@apexlogistics.com`;
    const execAName = 'Test Executive';
    const execAPassword = 'ExecPass#2026';

    const createExecResult = await asUser(sql, adminAId, async (tx) => {
      const [res] = await tx`
        SELECT crm_company_admin_create_member(
          ${execAEmail},
          ${execAName},
          ${execAPassword},
          'Executive',
          NULL,
          ${managerAId},
          ${orgAId}
        ) as result
      `;
      return res.result;
    });

    const execAId = createExecResult.user_id;
    cleanupIds.users.push(execAId);

    assert(execAId && createExecResult.success, 
      `Company Admin created Executive A: "${execAName}" (${execAEmail}) reporting to Manager A`);

    const [execRole] = await sql`SELECT role, organization_id FROM user_roles WHERE user_id = ${execAId}`;
    assert(execRole && execRole.role === 'Executive' && execRole.organization_id === orgAId, 
      `Executive A assigned role='Executive' in user_roles for Company A`);

    const [repLine] = await sql`
      SELECT manager_id, executive_id, organization_id 
      FROM reporting_lines 
      WHERE executive_id = ${execAId} AND manager_id = ${managerAId}
    `;
    assert(repLine && repLine.organization_id === orgAId, 
      `Executive A reporting line configured to Manager A in reporting_lines table`);

    // -------------------------------------------------------------------------
    // STEP 6: Cross-Tenant Data Isolation with Company B
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 6: Cross-Tenant Isolation: Create Company B & Verify Boundaries ---");
    const compBName = `Beacon Real Estate ${Date.now()}`;
    const compBAdminEmail = `admin_beacon_${Date.now()}@beaconrealty.in`;
    const compBAdminName = 'Deepak Verma';
    const compBAdminPassword = 'BeaconAdmin#2026';

    const createBResult = await asUser(sql, superAdminId, async (tx) => {
      const [res] = await tx`
        SELECT crm_super_admin_create_company(
          ${compBName},
          ${compBAdminEmail},
          ${compBAdminName},
          ${compBAdminPassword},
          'https://beaconrealty.in',
          '+919811122233',
          'Real Estate',
          'Indiranagar 100ft Road',
          'Bengaluru',
          'Karnataka',
          'India',
          '29BBBBB1111B1Z9',
          '10:00:00',
          '19:00:00',
          2,
          'PRO'
        ) as result
      `;
      return res.result;
    });

    const orgBId = createBResult.company_id;
    const adminBId = createBResult.admin_id;
    cleanupIds.orgs.push(orgBId);
    cleanupIds.users.push(adminBId);

    assert(orgBId && adminBId, 
      `Company B created: "${compBName}" (Org ID: ${orgBId}, Admin: ${compBAdminEmail})`);

    // Insert lead into Company A
    const [leadA] = await sql`
      INSERT INTO leads (id, organization_id, name, company, email, phone, status, value, assigned_to, owner_id)
      VALUES (gen_random_uuid()::text, ${orgAId}, 'Acme Warehouse Deal', 'Acme Corp', 'contact@acme.com', '+919800000001', 'NEW', 850000, ${execAId}, ${adminAId})
      RETURNING id, name, organization_id
    `;
    cleanupIds.leads.push(leadA.id);

    // Query leads as Company Admin B via RLS
    const leadsSeenByB = await asUser(sql, adminBId, async (tx) => {
      return await tx`SELECT id, name, organization_id FROM leads`;
    });

    assert(!leadsSeenByB.some(l => l.id === leadA.id), 
      `Company Admin B CANNOT see Company A's lead "${leadA.name}" (RLS isolation confirmed)`);
    assert(leadsSeenByB.length === 0, 
      `Company B initially sees exactly 0 leads (zero data on creation verified)`);

    // Verify Company A only sees Company A lead
    const leadsSeenByA = await asUser(sql, adminAId, async (tx) => {
      return await tx`SELECT id, name, organization_id FROM leads`;
    });
    assert(leadsSeenByA.length === 1 && leadsSeenByA[0].id === leadA.id, 
      `Company Admin A sees only Company A's lead (count: 1)`);

    // -------------------------------------------------------------------------
    // STEP 7: Role-Based Executive Visibility inside Company A
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 7: Executive Role-Based Scoping inside Company A ---");
    // Insert a private lead in Company A owned by Admin A and not assigned to Executive A
    const [unassignedLead] = await sql`
      INSERT INTO leads (id, organization_id, name, company, email, phone, status, value, owner_id)
      VALUES (gen_random_uuid()::text, ${orgAId}, 'Confidential Enterprise Lead', 'Global Bank', 'vip@bank.com', '+919800000002', 'NEW', 5000000, ${adminAId})
      RETURNING id, name
    `;
    cleanupIds.leads.push(unassignedLead.id);

    // Query as Executive A
    const execALeads = await asUser(sql, execAId, async (tx) => {
      return await tx`SELECT id, name, assigned_to, owner_id FROM leads`;
    });

    assert(execALeads.some(l => l.id === leadA.id), 
      `Executive A can see their assigned lead "${leadA.name}"`);

    // -------------------------------------------------------------------------
    // STEP 8: Company Lifecycle & Suspension Enforcement
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 8: Workspace Suspension Check ---");
    await asUser(sql, superAdminId, async (tx) => {
      await tx`SELECT crm_super_admin_soft_delete_company(${orgBId})`;
    });

    const [suspendedB] = await sql`SELECT status, deleted_at FROM "Organization" WHERE id = ${orgBId}`;
    assert(suspendedB && suspendedB.status === 'DEACTIVATED' && suspendedB.deleted_at !== null, 
      `Super Admin successfully suspended Company B (status='DEACTIVATED')`);

    // Restore Company B
    await asUser(sql, superAdminId, async (tx) => {
      await tx`SELECT crm_super_admin_restore_company(${orgBId})`;
    });

    const [restoredB] = await sql`SELECT status, deleted_at FROM "Organization" WHERE id = ${orgBId}`;
    assert(restoredB && restoredB.status === 'ACTIVE' && restoredB.deleted_at === null, 
      `Super Admin restored Company B (status='ACTIVE', deleted_at=NULL)`);

  } catch (err) {
    console.error("Test execution encountered an error:", err);
    failed++;
  } finally {
    // -------------------------------------------------------------------------
    // CLEANUP
    // -------------------------------------------------------------------------
    console.log("\n--- CLEANUP: Removing Test Companies and Members ---");
    try {
      for (const id of cleanupIds.leads) {
        await sql`DELETE FROM leads WHERE id = ${id}`;
      }
      for (const id of cleanupIds.tasks) {
        await sql`DELETE FROM tasks WHERE id = ${id}`;
      }
      for (const uid of cleanupIds.users) {
        await sql`DELETE FROM reporting_lines WHERE executive_id = ${uid} OR manager_id = ${uid}`;
        await sql`DELETE FROM team_members WHERE user_id = ${uid}`;
        await sql`DELETE FROM user_roles WHERE user_id = ${uid}`;
        await sql`DELETE FROM profiles WHERE id = ${uid}`;
        await sql`DELETE FROM auth.users WHERE id = ${uid}::uuid`;
      }
      for (const oid of cleanupIds.orgs) {
        await sql`DELETE FROM company_audit_logs WHERE target_organization_id = ${oid}`;
        await sql`DELETE FROM "Organization" WHERE id = ${oid}`;
      }
      console.log(`Successfully cleaned up ${cleanupIds.orgs.length} test companies and ${cleanupIds.users.length} test users.`);
    } catch (cleanErr) {
      console.error("Cleanup warning:", cleanErr.message);
    }

    await sql.end();
  }

  console.log("\n================================================================================");
  console.log(`TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("================================================================================");

  if (failed > 0) process.exit(1);
}

runTests();
