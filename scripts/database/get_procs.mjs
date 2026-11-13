import postgres from '../../node_modules/postgres/src/index.js';
import fs from 'fs';
const env = fs.readFileSync('.env', 'utf8');
const directUrl = env.match(/DIRECT_URL="([^"]+)"/)?.[1];
const sql = postgres(directUrl, { ssl: 'require' });
async function run() {
  const procs = await sql`SELECT proname, prosrc FROM pg_proc WHERE proname ILIKE '%lead%' OR proname ILIKE '%crm%'`;
  for (const p of procs) {
    console.log(`=== ${p.proname} ===\n${p.prosrc}\n`);
  }
  await sql.end();
}
run();
