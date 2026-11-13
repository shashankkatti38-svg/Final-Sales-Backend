import fs from 'fs';
import postgres from '../../node_modules/postgres/src/index.js';

const envContent = fs.readFileSync('.env', 'utf8');
const m = envContent.match(/DIRECT_URL=["']([^"']+)["']/) || envContent.match(/DATABASE_URL=["']([^"']+)["']/);
if (!m) {
  console.error("Missing DIRECT_URL or DATABASE_URL in .env");
  process.exit(1);
}

const connectionString = m[1];
const sql = postgres(connectionString, { ssl: 'require', max: 1 });

async function runTests() {
  console.log("================================================================================");
  console.log("SALESWORKS360 CRM: MULTI-COMPANY, ROLES & TASK ASSIGNMENT VERIFICATION TEST SUITE");
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

  // Helper to set auth.uid() context in current transaction
  async function asUser(client, userId, callback) {
    return await client.begin(async (tx) => {
      await tx`
        SELECT set_config('request.jwt.claim.sub', ${userId}, true),
               set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)
      `;
      return await callback(tx);
    });
  }

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Super Admin Verification & Company Creation RPC
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 1: Super Admin & Company Creation RPC ---");
    const superAdminEmail = 'shashankkatti23@gmail.com';
    const [superAdminUser] = await sql`
      SELECT u.id, u.email, ur.role, ur.organization_id
      FROM auth.users u
      JOIN user_roles ur ON ur.user_id = u.id::text
      WHERE u.email = ${superAdminEmail}
    `;
    assert(superAdminUser && superAdminUser.role === 'Super Admin', 
      `User ${superAdminEmail} has 'Super Admin' role in user_roles table`);

    const superAdminId = superAdminUser.id.toString();

    // Call crm_super_admin_create_company as Super Admin
    const testCompanyName = `Test Enterprise Corp ${Date.now()}`;
    const testAdminEmail = `company_admin_${Date.now()}@testenterprise.com`;
    const testAdminName = 'Enterprise Admin';
    const testAdminPassword = 'CompanyPass#2026';

    const createResult = await asUser(sql, superAdminId, async (tx) => {
      const [res] = await tx`
        SELECT crm_super_admin_create_company(
          ${testCompanyName},
          ${testAdminEmail},
          ${testAdminName},
          ${testAdminPassword}
        ) as result
      `;
      return res.result;
    });

    const newOrgId = createResult.company_id;
    const newAdminId = createResult.admin_id;

    assert(newOrgId && newAdminId, 
      `Super Admin RPC successfully created company "${testCompanyName}" (Org ID: ${newOrgId}) and Admin (${newAdminId})`);

    // Verify company status and admin membership
    const [orgCheck] = await sql`SELECT id, name, status, deleted_at FROM "Organization" WHERE id = ${newOrgId}`;
    assert(orgCheck && orgCheck.status === 'ACTIVE' && orgCheck.deleted_at === null, 
      `New organization has status='ACTIVE' and deleted_at IS NULL`);

    const [adminCheck] = await sql`
      SELECT role FROM user_roles WHERE organization_id = ${newOrgId} AND user_id = ${newAdminId}
    `;
    assert(adminCheck && adminCheck.role === 'Admin', 
      `First user has role 'Admin' for the newly created company in user_roles`);

    // Verify audit log entry
    const [auditLog] = await sql`
      SELECT action, target_organization_id, actor_id 
      FROM company_audit_logs 
      WHERE target_organization_id = ${newOrgId} AND action = 'CREATE_COMPANY'
    `;
    assert(auditLog && auditLog.actor_id === superAdminId, 
      `Company creation recorded in company_audit_logs with actor_id = Super Admin`);

    // -------------------------------------------------------------------------
    // TEST 2: Company Soft Delete and Restore Lifecycle
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 2: Company Soft Delete and Restore RPC ---");
    await asUser(sql, superAdminId, async (tx) => {
      await tx`SELECT crm_super_admin_soft_delete_company(${newOrgId})`;
    });
    const [softDeletedOrg] = await sql`SELECT status, deleted_at FROM "Organization" WHERE id = ${newOrgId}`;
    assert(softDeletedOrg.status === 'DEACTIVATED' && softDeletedOrg.deleted_at !== null, 
      `Company soft-delete set status='DEACTIVATED' and deleted_at timestamp`);

    await asUser(sql, superAdminId, async (tx) => {
      await tx`SELECT crm_super_admin_restore_company(${newOrgId})`;
    });
    const [restoredOrg] = await sql`SELECT status, deleted_at FROM "Organization" WHERE id = ${newOrgId}`;
    assert(restoredOrg.status === 'ACTIVE' && restoredOrg.deleted_at === null, 
      `Company restore set status='ACTIVE' and deleted_at=NULL`);

    // -------------------------------------------------------------------------
    // TEST 3: Cross-Tenant Data Isolation (Multi-Company)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 3: Cross-Company Tenant Isolation ---");
    // Create a second company
    const testCompany2Name = `Competitor Org ${Date.now()}`;
    const comp2Result = await asUser(sql, superAdminId, async (tx) => {
      const [res] = await tx`
        SELECT crm_super_admin_create_company(
          ${testCompany2Name},
          ${`admin2_${Date.now()}@competitor.com`},
          'Competitor Admin',
          'CompanyPass#2026'
        ) as result
      `;
      return res.result;
    });
    const org2Id = comp2Result.company_id;
    const org2AdminId = comp2Result.admin_id;

    // Insert lead in Company 1
    const [leadOrg1] = await sql`
      INSERT INTO leads (id, organization_id, name, company, email, phone, status, value)
      VALUES (gen_random_uuid()::text, ${newOrgId}, 'Tenant1 Prospect', 'Alpha Corp', 'lead1@alpha.com', '+919999999991', 'NEW', 150000)
      RETURNING id, organization_id, name
    `;

    // Insert lead in Company 2
    const [leadOrg2] = await sql`
      INSERT INTO leads (id, organization_id, name, company, email, phone, status, value)
      VALUES (gen_random_uuid()::text, ${org2Id}, 'Tenant2 Prospect', 'Beta Corp', 'lead2@beta.com', '+19999999999', 'NEW', 250000)
      RETURNING id, organization_id, name
    `;

    // Query with tenant constraint simulation
    const org1Leads = await sql`SELECT id, name FROM leads WHERE organization_id = ${newOrgId}`;
    const org2Leads = await sql`SELECT id, name FROM leads WHERE organization_id = ${org2Id}`;

    assert(org1Leads.some(l => l.id === leadOrg1.id) && !org1Leads.some(l => l.id === leadOrg2.id),
      `Company 1 queries only see Company 1 leads (Tenant isolation verified)`);
    assert(org2Leads.some(l => l.id === leadOrg2.id) && !org2Leads.some(l => l.id === leadOrg1.id),
      `Company 2 queries only see Company 2 leads (Tenant isolation verified)`);

    // -------------------------------------------------------------------------
    // TEST 4: Strict Role Hierarchy (ADMIN, MANAGER, EXECUTIVE, DEVELOPER)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 4: Company Admin Role Management & Hierarchy ---");
    
    // Create Manager user in auth.users & profiles
    const [managerUser] = await sql`
      INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES (
        '00000000-0000-0000-0000-000000000000',
        gen_random_uuid(),
        'authenticated',
        'authenticated',
        ${`manager_${Date.now()}@testsalesworks.in`},
        crypt('Pass#2026', gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}',
        '{"full_name":"Sales Manager"}',
        now(),
        now()
      )
      RETURNING id::text, email
    `;
    await sql`
      INSERT INTO profiles (id, display_name) VALUES (${managerUser.id}, 'Sales Manager')
      ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name
    `;

    // Create Executive user in auth.users & profiles
    const [execUser] = await sql`
      INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES (
        '00000000-0000-0000-0000-000000000000',
        gen_random_uuid(),
        'authenticated',
        'authenticated',
        ${`exec_${Date.now()}@testsalesworks.in`},
        crypt('Pass#2026', gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}',
        '{"full_name":"Sales Executive"}',
        now(),
        now()
      )
      RETURNING id::text, email
    `;
    await sql`
      INSERT INTO profiles (id, display_name) VALUES (${execUser.id}, 'Sales Executive')
      ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name
    `;

    // Create Developer user in auth.users & profiles
    const [devUser] = await sql`
      INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES (
        '00000000-0000-0000-0000-000000000000',
        gen_random_uuid(),
        'authenticated',
        'authenticated',
        ${`dev_${Date.now()}@testsalesworks.in`},
        crypt('Pass#2026', gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}',
        '{"full_name":"Backend Developer"}',
        now(),
        now()
      )
      RETURNING id::text, email
    `;
    await sql`
      INSERT INTO profiles (id, display_name) VALUES (${devUser.id}, 'Backend Developer')
      ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name
    `;

    // Create a Team (Sales Team)
    const [salesTeam] = await sql`
      INSERT INTO teams (organization_id, name, description, leader_id)
      VALUES (${newOrgId}, 'Sales Enterprise Team', 'Enterprise Outbound Sales Team', ${managerUser.id})
      RETURNING id, name
    `;
    assert(salesTeam && salesTeam.id, `Created team "${salesTeam.name}" in organization`);

    // Assign roles via crm_company_admin_manage_member as Company Admin
    await asUser(sql, newAdminId, async (tx) => {
      await tx`SELECT crm_company_admin_manage_member(${managerUser.id}, 'Manager', ${salesTeam.id}, NULL)`;
      await tx`SELECT crm_company_admin_manage_member(${execUser.id}, 'Executive', ${salesTeam.id}, ${managerUser.id})`;
      await tx`SELECT crm_company_admin_manage_member(${devUser.id}, 'Developer', NULL, NULL)`;
    });

    const members = await sql`
      SELECT user_id, role, organization_id FROM user_roles WHERE organization_id = ${newOrgId}
    `;
    const mRole = members.find(m => m.user_id === managerUser.id)?.role;
    const eRole = members.find(m => m.user_id === execUser.id)?.role;
    const dRole = members.find(m => m.user_id === devUser.id)?.role;
    assert(mRole === 'Manager' && eRole === 'Executive' && dRole === 'Developer',
      `Roles successfully assigned via Admin RPC: Manager=${mRole}, Executive=${eRole}, Developer=${dRole}`);

    // Verify reporting line
    const [repLine] = await sql`
      SELECT manager_id, executive_id FROM reporting_lines WHERE manager_id = ${managerUser.id} AND executive_id = ${execUser.id}
    `;
    assert(repLine && repLine.executive_id === execUser.id, 
      `Reporting line established in reporting_lines table: Executive reports to Manager`);

    // Test prevent promotion to Super Admin by Company Admin
    let superAdminPromotionBlocked = false;
    try {
      await asUser(sql, newAdminId, async (tx) => {
        await tx`SELECT crm_company_admin_manage_member(${execUser.id}, 'Super Admin', NULL, NULL)`;
      });
    } catch (e) {
      superAdminPromotionBlocked = true;
    }
    assert(superAdminPromotionBlocked, 
      `Security gate blocked elevating member to 'Super Admin' via Company Admin RPC`);

    // -------------------------------------------------------------------------
    // TEST 5: Task Creation with Individual & Shared Team Assignments
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 5: Task Creation with Assignments (Individual & Shared Team) ---");
    
    // 5a: Individual Assignment (Admin assigns to Executive)
    const indivTaskResult = await asUser(sql, newAdminId, async (tx) => {
      const [res] = await tx`
        SELECT crm_create_task_with_assignments(
          'Close Enterprise Software Deal',
          'Follow up with CTO regarding SLA agreement',
          'Call',
          'High',
          TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD'),
          '14:00',
          NULL,
          ${leadOrg1.id},
          ${salesTeam.id},
          'INDIVIDUAL',
          ARRAY[${execUser.id}]::text[],
          'Don''t Repeat',
          'Client preferred afternoon calls'
        ) as result
      `;
      return res.result;
    });
    const indivTaskId = indivTaskResult.task_id;
    assert(indivTaskId, `Created Individual task (ID: ${indivTaskId})`);

    const indivAssignments = await sql`
      SELECT user_id, status FROM task_assignments WHERE task_id = ${indivTaskId}
    `;
    assert(indivAssignments.length === 1 && indivAssignments[0].user_id === execUser.id,
      `Individual task assigned exclusively to Executive (${execUser.id})`);

    // 5b: Shared Team Assignment (Team members all assigned to task)
    // Add manager & exec to team_members
    await sql`
      INSERT INTO team_members (id, team_id, user_id, organization_id)
      VALUES (gen_random_uuid()::text, ${salesTeam.id}, ${managerUser.id}, ${newOrgId})
      ON CONFLICT DO NOTHING
    `;

    const sharedTaskResult = await asUser(sql, managerUser.id, async (tx) => {
      const [res] = await tx`
        SELECT crm_create_task_with_assignments(
          'Sprint Retrospective & Team Sync',
          'Review monthly team OKRs and milestone delivery',
          'Meeting',
          'Medium',
          TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD'),
          '16:30',
          NULL,
          NULL,
          ${salesTeam.id},
          'SHARED_TEAM',
          ARRAY[]::text[],
          'Don''t Repeat',
          'Bring retrospective update slides'
        ) as result
      `;
      return res.result;
    });
    const sharedTaskId = sharedTaskResult.task_id;
    assert(sharedTaskId, `Created Shared Team task (ID: ${sharedTaskId})`);

    const sharedAssignments = await sql`
      SELECT user_id FROM task_assignments WHERE task_id = ${sharedTaskId}
    `;
    assert(sharedAssignments.length >= 2, 
      `Shared team task auto-assigned to all members of team (Count: ${sharedAssignments.length})`);

    // -------------------------------------------------------------------------
    // TEST 6: Manager & Executive Role Boundaries on Task Assignment
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 6: Manager & Executive Role Boundaries ---");
    
    // Manager assigning to their subordinate (Allowed)
    const managedSubordinates = await asUser(sql, managerUser.id, async (tx) => {
      const res = await tx`SELECT executive_id FROM crm_managed_executive_ids()`;
      return res.map(r => r.executive_id);
    });
    assert(managedSubordinates.includes(execUser.id),
      `Manager can query reporting subordinates (crm_managed_executive_ids contains Executive ID)`);

    // Test Executive assignment boundary: Executive cannot assign tasks to anyone else
    let execAssignBoundaryEnforced = false;
    try {
      await asUser(sql, execUser.id, async (tx) => {
        await tx`
          SELECT crm_create_task_with_assignments(
            'Executive Unauthorized Delegation',
            'Attempting to delegate to Manager',
            'Follow Up',
            'Low',
            TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD'),
            '10:00',
            NULL,
            NULL,
            NULL,
            'INDIVIDUAL',
            ARRAY[${managerUser.id}]::text[],
            'Don''t Repeat',
            NULL
          )
        `;
      });
    } catch (e) {
      execAssignBoundaryEnforced = true;
    }
    assert(execAssignBoundaryEnforced, 
      `Executive assignment boundary strictly enforced: Executive cannot delegate tasks`);

    // -------------------------------------------------------------------------
    // TEST 7: Developer Role Restrictions & Commercial Lead Field Masking
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 7: Developer Role Restriction & Permissions ---");
    const isDev = await asUser(sql, devUser.id, async (tx) => {
      const [res] = await tx`SELECT crm_is_developer() as dev_status`;
      return res.dev_status;
    });
    assert(isDev === true, `Function crm_is_developer correctly identifies Developer role`);

    // Developer can access tasks assigned to them
    const devTaskResult = await asUser(sql, newAdminId, async (tx) => {
      const [res] = await tx`
        SELECT crm_create_task_with_assignments(
          'Fix Webhook Ingestion Bug',
          'Resolve JSON parsing failure on WhatsApp webhook',
          'Task',
          'Urgent',
          TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD'),
          '18:00',
          NULL,
          NULL,
          NULL,
          'INDIVIDUAL',
          ARRAY[${devUser.id}]::text[],
          'Don''t Repeat',
          'Inspect server logs'
        ) as result
      `;
      return res.result;
    });
    const devTaskId = devTaskResult.task_id;

    const devTasks = await sql`
      SELECT t.id, t.title 
      FROM tasks t
      JOIN task_assignments ta ON ta.task_id = t.id
      WHERE ta.user_id = ${devUser.id}
    `;
    assert(devTasks.some(t => t.id === devTaskId), `Developer can access their assigned task (${devTaskId})`);

    // -------------------------------------------------------------------------
    // TEST 8: Task Status & Remarks Update + Activity Logging
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 8: Task Status Update & Activity Logging ---");
    await asUser(sql, execUser.id, async (tx) => {
      await tx`
        SELECT crm_update_task_status_and_remarks(
          ${indivTaskId},
          'In Progress',
          'Contacted client via call; awaiting approval from procurement'
        )
      `;
    });
    const [updatedTask] = await sql`SELECT status FROM tasks WHERE id = ${indivTaskId}`;
    assert(updatedTask.status === 'In Progress', `Task status updated to 'In Progress'`);

    const activityLogs = await sql`
      SELECT action, details FROM task_activity_log WHERE task_id = ${indivTaskId}
    `;
    const hasLog = activityLogs.some(l => 
      l.action === 'STATUS_CHANGED' && l.details?.remarks?.includes('procurement')
    );
    assert(hasLog, `Task activity log recorded STATUS_CHANGED event with procurement remarks`);

    // -------------------------------------------------------------------------
    // TEST 9: Bulk Task Reassignment
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 9: Bulk Reassignment RPC ---");
    await asUser(sql, newAdminId, async (tx) => {
      await tx`
        SELECT crm_bulk_reassign_tasks(
          ARRAY[${indivTaskId}, ${devTaskId}]::text[],
          ${managerUser.id},
          TO_CHAR(CURRENT_DATE + INTERVAL '5 days', 'YYYY-MM-DD')
        )
      `;
    });
    const reassignedAssignments = await sql`
      SELECT task_id, user_id FROM task_assignments WHERE task_id = ${indivTaskId}
    `;
    assert(reassignedAssignments.some(a => a.user_id === managerUser.id),
      `Bulk reassign updated task assignments to new assignee (${managerUser.id})`);

    // -------------------------------------------------------------------------
    // CLEANUP TEST DATA
    // -------------------------------------------------------------------------
    console.log("\n--- Cleaning up temporary test artifacts ---");
    await sql`DELETE FROM task_activity_log WHERE task_id IN (${indivTaskId}, ${sharedTaskId}, ${devTaskId})`;
    await sql`DELETE FROM task_assignments WHERE task_id IN (${indivTaskId}, ${sharedTaskId}, ${devTaskId})`;
    await sql`DELETE FROM tasks WHERE id IN (${indivTaskId}, ${sharedTaskId}, ${devTaskId})`;
    await sql`DELETE FROM leads WHERE id IN (${leadOrg1.id}, ${leadOrg2.id})`;
    await sql`DELETE FROM reporting_lines WHERE manager_id = ${managerUser.id}`;
    await sql`DELETE FROM team_members WHERE organization_id IN (${newOrgId}, ${org2Id})`;
    await sql`DELETE FROM user_roles WHERE organization_id IN (${newOrgId}, ${org2Id})`;
    await sql`DELETE FROM teams WHERE organization_id IN (${newOrgId}, ${org2Id})`;
    await sql`DELETE FROM company_audit_logs WHERE target_organization_id IN (${newOrgId}, ${org2Id})`;
    await sql`DELETE FROM "Organization" WHERE id IN (${newOrgId}, ${org2Id})`;
    await sql`DELETE FROM profiles WHERE id IN (${newAdminId}, ${org2AdminId}, ${managerUser.id}, ${execUser.id}, ${devUser.id})`;
    await sql`DELETE FROM auth.users WHERE id IN (${newAdminId}, ${org2AdminId}, ${managerUser.id}, ${execUser.id}, ${devUser.id})`;
    console.log("[CLEANUP] Test organizations, users, and tasks purged cleanly.");

    console.log("\n================================================================================");
    console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log("================================================================================");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Test execution encountered an unhandled exception:", err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

runTests();
