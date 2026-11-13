import postgres from '../../node_modules/postgres/src/index.js';

const sql = postgres(process.env.DIRECT_URL, { ssl: 'require' });

async function dump() {
  const tables = ['leads', 'call_logs', 'tasks', 'activities', 'sales_documents', 'payments', 'products', 'profiles'];
  for (const t of tables) {
    try {
      const rows = await sql`SELECT * FROM public.${sql(t)};`;
      console.log(`\n=== TABLE: ${t} (${rows.length} rows) ===`);
      console.dir(rows, { depth: null });
    } catch (e) {
      console.log(`Table ${t} error:`, e.message);
    }
  }
  await sql.end();
}

dump().catch(console.error);
