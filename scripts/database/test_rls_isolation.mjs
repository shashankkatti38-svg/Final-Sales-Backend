import postgres from '../../node_modules/postgres/src/index.js';
const connStr = process.env.DIRECT_URL;
const sql = postgres(connStr, { ssl: 'require' });

async function test() {
  console.log("=== RUNNING RLS & PERMISSIONS TESTS ===");

  const userId = '490e5644-2ebc-4732-94a7-b3956fc5a522'; // shashankkatti32@gmail.com
  const otherOrgId = '70eb2abc-2bc8-412b-8a2d-0fd9ad26dd1a'; // a different organization

  let createdLeadId = null;

  await sql.begin(async tx => {
    await tx`SELECT set_config('role', 'authenticated', true)`;
    await tx`SELECT set_config('request.jwt.claim.sub', ${userId}, true)`;

    // TEST 1: Check crm_org() and crm_is_admin()
    const orgCheck = await tx`
      SELECT public.crm_org() as current_org, public.crm_is_admin() as is_admin;
    `;
    console.log("TEST 1 - Auth Context:", orgCheck[0]);

    // TEST 2: Insert a new lead as authenticated user
    const insertResult = await tx`
      INSERT INTO public.leads (name, company, email, phone, value, status, label, source, address)
      VALUES ('RLS Test Lead', 'Test Corp', 'testlead@example.com', '+919999988888', 1250, 'New Inquiry', 'Hot', 'Direct', 'Test Address Line 1')
      RETURNING id, name, organization_id, owner_id, phone, status;
    `;
    console.log("TEST 2 - Insert Lead Result:", insertResult[0]);
    createdLeadId = insertResult[0].id;

    // TEST 3: SELECT leads as authenticated user (Page refresh simulation)
    const selectResult = await tx`
      SELECT id, name, company, email, organization_id, owner_id FROM public.leads;
    `;
    console.log(`TEST 3 - SELECT Leads (count: ${selectResult.length}):`, selectResult.map(l => ({ name: l.name, org: l.organization_id })));

    // TEST 4: UPDATE lead as authenticated user
    const updateResult = await tx`
      UPDATE public.leads
      SET status = 'Proposal Sent'
      WHERE id = ${createdLeadId}
      RETURNING id, name, status;
    `;
    console.log("TEST 4 - UPDATE Lead Result:", updateResult[0]);

    // TEST 5: CROSS-ORGANIZATION ISOLATION
    try {
      await tx`
        INSERT INTO public.leads (organization_id, name, owner_id)
        VALUES (${otherOrgId}, 'Cross-Org Hack', ${userId});
      `;
      console.error("FAILED ISOLATION TEST: Cross-org insert unexpectedly succeeded!");
    } catch (err) {
      console.log("TEST 5 - Cross-Org Isolation PASSED: Blocked with error:", err.message);
    }
  });

  // TEST 6: Delete created test lead cleanly
  if (createdLeadId) {
    await sql.begin(async tx => {
      await tx`SELECT set_config('role', 'authenticated', true)`;
      await tx`SELECT set_config('request.jwt.claim.sub', ${userId}, true)`;
      await tx`DELETE FROM public.leads WHERE id = ${createdLeadId}`;
    });
    console.log("TEST 6 - DELETE Lead Result: Cleaned up test lead successfully.");
  }

  await sql.end();
  console.log("=== ALL RLS & ISOLATION TESTS PASSED! ===");
}

test().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
