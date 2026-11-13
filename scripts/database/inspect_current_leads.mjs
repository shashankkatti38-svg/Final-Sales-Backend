import postgres from '../../node_modules/postgres/src/index.js';

const sql = postgres(process.env.DIRECT_URL, { ssl: 'require' });

async function check() {
  const tables = await sql`
    SELECT table_schema, table_name 
    FROM information_schema.tables 
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema') 
    ORDER BY table_schema, table_name;
  `;
  console.log("=== ALL TABLES IN DATABASE ===");
  console.table(tables);

  const authUsers = await sql`SELECT id, email, created_at FROM auth.users;`;
  console.log("\n=== AUTH USERS ===");
  console.table(authUsers);

  const allLeads = await sql`SELECT * FROM public.leads;`;
  console.log("\n=== PUBLIC.LEADS ===");
  console.table(allLeads);

  await sql.end();
}

check().catch(console.error);
