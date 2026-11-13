import postgres from '../../node_modules/postgres/src/index.js';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const directUrl = env.match(/DIRECT_URL="([^"]+)"/)?.[1];
const sql = postgres(directUrl, { ssl: 'require' });

async function check() {
  const policies = await sql`
    SELECT tablename, policyname, roles, cmd, qual, with_check 
    FROM pg_policies 
    WHERE schemaname = 'public' AND tablename IN ('user_roles', 'organizations', 'profiles', 'leads')
    ORDER BY tablename, policyname;
  `;
  console.log('=== POLICIES ===');
  console.log(JSON.stringify(policies, null, 2));

  const procSec = await sql`
    SELECT proname, prosecdef, prosrc
    FROM pg_proc 
    WHERE proname IN ('crm_org', 'crm_is_admin', 'set_default_lead_org');
  `;
  console.log('=== PROC SEC ===');
  console.log(JSON.stringify(procSec, null, 2));

  await sql.end();
}
check();
