import postgres from '../../node_modules/postgres/src/index.js';
const conn = 'postgresql://postgres.kqozkwydmtmwotmzxpax:%3FW%2BYwhF2uUp%2AJF8@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';
const sql = postgres(conn, { ssl: 'require' });

async function run() {
  const all = await sql`SELECT id, name, company, phone, email, status, value, source, created_at FROM public.leads ORDER BY created_at DESC;`;
  console.log('Postgres direct count in leads table:', all.length);
  for (const l of all) {
    console.log(l.id, l.name, 'Source:', l.source, l.created_at);
  }
  
  // Also check if there are other tables or schemas!
  const tables = await sql`SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name;`;
  console.log('\nTables in DB:');
  for (const t of tables) {
    console.log(t.table_schema + '.' + t.table_name);
  }

  await sql.end();
}
run().catch(console.error);
