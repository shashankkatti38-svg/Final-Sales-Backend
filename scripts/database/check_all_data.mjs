import postgres from '../../node_modules/postgres/src/index.js';
const connStr = process.env.DIRECT_URL;
const sql = postgres(connStr, { ssl: 'require' });

async function main() {
  const leads = await sql`SELECT id, name, company, email, phone, value, status, label, source, created_at, owner_id, organization_id FROM public.leads ORDER BY created_at DESC;`;
  console.log("LEADS in DB:", leads);

  const activities = await sql`SELECT * FROM public.activities ORDER BY occurred_at DESC;`;
  console.log("ACTIVITIES in DB:", activities);

  const tasks = await sql`SELECT * FROM public.tasks;`;
  console.log("TASKS in DB:", tasks);

  const calls = await sql`SELECT * FROM public.call_logs;`;
  console.log("CALLS in DB:", calls);

  await sql.end();
}

main().catch(console.error);
