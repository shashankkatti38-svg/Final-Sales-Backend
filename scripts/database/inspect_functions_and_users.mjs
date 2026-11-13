import postgres from '../../node_modules/postgres/src/index.js';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const directUrl = env.match(/DIRECT_URL="([^"]+)"/)?.[1];
const sql = postgres(directUrl, { ssl: 'require' });

async function main() {
  console.log('=== Function definitions ===');
  const procs = await sql`
    SELECT proname, prosrc 
    FROM pg_proc 
    WHERE proname IN ('crm_org', 'crm_is_admin', 'set_default_lead_org');
  `;
  for (const p of procs) {
    console.log(`--- ${p.proname} ---`);
    console.log(p.prosrc);
  }

  console.log('\n=== Columns of profiles ===');
  const profCols = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'profiles';
  `;
  console.log(profCols.map(c => c.column_name).join(', '));

  console.log('\n=== Content of profiles ===');
  const profiles = await sql`SELECT * FROM profiles LIMIT 10`;
  console.log(profiles);

  console.log('\n=== Content of user_roles ===');
  const userRoles = await sql`SELECT * FROM user_roles`;
  console.log(userRoles);

  console.log('\n=== Content of organizations ===');
  const orgs = await sql`SELECT * FROM organizations`;
  console.log(orgs);

  console.log('\n=== Auth users (from auth.users if accessible) ===');
  try {
    const authUsers = await sql`SELECT id, email FROM auth.users`;
    console.log('auth.users:', authUsers);
  } catch (err) {
    console.log('Cannot query auth.users:', err.message);
  }

  await sql.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
