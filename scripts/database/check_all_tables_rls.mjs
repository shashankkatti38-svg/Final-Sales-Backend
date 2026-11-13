import postgres from '../../node_modules/postgres/src/index.js';
const connStr = process.env.DIRECT_URL;
const sql = postgres(connStr, { ssl: 'require' });

async function check() {
  const rls = await sql`
    SELECT relname, relrowsecurity
    FROM pg_class
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE pg_namespace.nspname = 'public' AND relkind = 'r'
    ORDER BY relname;
  `;
  console.log("ALL TABLES RLS STATUS:", rls);
  await sql.end();
}

check().catch(console.error);
