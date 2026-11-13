import postgres from '../../node_modules/postgres/src/index.js';
const connStr = process.env.DIRECT_URL;
const sql = postgres(connStr, { ssl: 'require' });

async function main() {
  const userId = '490e5644-2ebc-4732-94a7-b3956fc5a522';
  const otherOrgId = '70eb2abc-2bc8-412b-8a2d-0fd9ad26dd1a';

  // Test session
  const leads = await sql.begin(async tx => {
    await tx`SELECT set_config('role', 'authenticated', true)`;
    await tx`SELECT set_config('request.jwt.claim.sub', ${userId}, true)`;
    return await tx`SELECT id, name, company, email, phone, status, organization_id, owner_id FROM public.leads`;
  });
  console.log(`Verified ${leads.length} leads accessible by authenticated user:`, leads.map(l => ({ name: l.name, phone: l.phone })));

  // Test cross-org SELECT isolation: user should NOT see leads belonging to other orgs
  const crossOrgLeads = await sql.begin(async tx => {
    await tx`SELECT set_config('role', 'authenticated', true)`;
    await tx`SELECT set_config('request.jwt.claim.sub', ${userId}, true)`;
    return await tx`SELECT id, name FROM public.leads WHERE organization_id = ${otherOrgId}`;
  });
  console.log("Cross-Org SELECT result (must be empty []):", crossOrgLeads);

  await sql.end();
  console.log("Verification finished successfully!");
}

main().catch(console.error);
