import postgres from '../../node_modules/postgres/src/index.js';
const connStr = process.env.DIRECT_URL;
const sql = postgres(connStr, { ssl: 'require' });

async function check() {
  const orgs = await sql`SELECT * FROM public.organizations;`;
  console.log("Organizations view output count:", orgs.length, orgs.map(o => ({ id: o.id, name: o.name })));
  await sql.end();
}

check().catch(console.error);
