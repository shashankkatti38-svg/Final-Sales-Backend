import postgres from '../../node_modules/postgres/src/index.js';
const sql = postgres(process.env.DIRECT_URL, { ssl: 'require' });

async function main() {
  const PRIMARY_ORG_ID = '4df15334-08f1-4ea8-a764-c36266fbfdba';

  // 1. Rename primary organization to SalesWorks360
  await sql`UPDATE public.organizations SET name = 'SalesWorks360' WHERE id = ${PRIMARY_ORG_ID};`;
  console.log("✓ Primary organization name set to SalesWorks360");

  // 2. Fetch all registered users
  const users = await sql`SELECT id, email FROM auth.users;`;
  console.log(`✓ Found ${users.length} users:`, users.map(u => u.email));

  // 3. Assign every user to the primary organization as Organization Admin
  for (const u of users) {
    await sql`DELETE FROM public.user_roles WHERE user_id = ${u.id};`;
    await sql`
      INSERT INTO public.user_roles (id, user_id, organization_id, role)
      VALUES (gen_random_uuid(), ${u.id}, ${PRIMARY_ORG_ID}, 'Organization Admin');
    `;
    console.log(`  -> Linked ${u.email} (${u.id}) to SalesWorks360 org`);
  }

  // 4. Update ALL leads to belong to primary organization
  const updatedLeads = await sql`
    UPDATE public.leads 
    SET organization_id = ${PRIMARY_ORG_ID}
    WHERE organization_id IS NULL OR organization_id != ${PRIMARY_ORG_ID}
    RETURNING id, name;
  `;
  console.log(`✓ Updated ${updatedLeads.length} leads to primary organization`);

  // 5. Update ALL call logs to belong to primary organization
  const updatedCalls = await sql`
    UPDATE public.call_logs 
    SET organization_id = ${PRIMARY_ORG_ID}
    WHERE organization_id IS NULL OR organization_id != ${PRIMARY_ORG_ID}
    RETURNING id;
  `;
  console.log(`✓ Updated ${updatedCalls.length} call logs to primary organization`);

  // 6. Update ALL tasks to belong to primary organization
  const updatedTasks = await sql`
    UPDATE public.tasks 
    SET organization_id = ${PRIMARY_ORG_ID}
    WHERE organization_id IS NULL OR organization_id != ${PRIMARY_ORG_ID}
    RETURNING id;
  `;
  console.log(`✓ Updated ${updatedTasks.length} tasks to primary organization`);

  // 7. Update ALL activities to belong to primary organization
  const updatedActivities = await sql`
    UPDATE public.activities 
    SET organization_id = ${PRIMARY_ORG_ID}
    WHERE organization_id IS NULL OR organization_id != ${PRIMARY_ORG_ID}
    RETURNING id;
  `;
  console.log(`✓ Updated ${updatedActivities.length} activities to primary organization`);

  // 8. Verify total leads count in org
  const totalLeads = await sql`SELECT count(*) FROM public.leads WHERE organization_id = ${PRIMARY_ORG_ID};`;
  const totalCalls = await sql`SELECT count(*) FROM public.call_logs WHERE organization_id = ${PRIMARY_ORG_ID};`;
  const totalTasks = await sql`SELECT count(*) FROM public.tasks WHERE organization_id = ${PRIMARY_ORG_ID};`;
  console.log(`===============================================`);
  console.log(`DATA SYNCHRONIZATION FINISHED SUCCESSFULLY!`);
  console.log(`Total Leads in SalesWorks360 Org: ${totalLeads[0].count}`);
  console.log(`Total Calls in SalesWorks360 Org: ${totalCalls[0].count}`);
  console.log(`Total Tasks in SalesWorks360 Org: ${totalTasks[0].count}`);
  console.log(`===============================================`);

  await sql.end();
}

main().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
