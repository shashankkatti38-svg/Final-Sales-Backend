import postgres from '../../node_modules/postgres/src/index.js';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const directUrl = env.match(/DIRECT_URL="([^"]+)"/)?.[1];
const sql = postgres(directUrl, { ssl: 'require' });

async function main() {
  console.log('=== QUERY A: Existing leads policies ===');
  const policies = await sql`
    SELECT policyname, permissive, roles, cmd, qual, with_check 
    FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'leads' 
    ORDER BY policyname;
  `;
  console.log(JSON.stringify(policies, null, 2));

  console.log('\n=== QUERY B: Leads table columns ===');
  const columns = await sql`
    SELECT column_name, data_type, is_nullable, column_default 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'leads' 
    ORDER BY ordinal_position;
  `;
  console.log(JSON.stringify(columns, null, 2));

  console.log('\n=== QUERY C: Existing table privileges ===');
  const grants = await sql`
    SELECT grantee, privilege_type 
    FROM information_schema.role_table_grants 
    WHERE table_schema = 'public' AND table_name = 'leads' 
    ORDER BY grantee, privilege_type;
  `;
  console.log(JSON.stringify(grants, null, 2));

  console.log('\n=== QUERY D: Existing triggers ===');
  const triggers = await sql`
    SELECT trigger_name, event_manipulation, action_timing, action_statement 
    FROM information_schema.triggers 
    WHERE event_object_schema = 'public' AND event_object_table = 'leads';
  `;
  console.log(JSON.stringify(triggers, null, 2));

  console.log('\n=== QUERY E: RLS configuration ===');
  const rlsConfig = await sql`
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity 
    FROM pg_class c 
    JOIN pg_namespace n ON n.oid = c.relnamespace 
    WHERE n.nspname = 'public' AND c.relname = 'leads';
  `;
  console.log(JSON.stringify(rlsConfig, null, 2));

  console.log('\n=== Check User Roles and Organizations for Chandram Sanapur ===');
  const profiles = await sql`SELECT * FROM profiles WHERE display_name ILIKE '%Chandram%' OR email ILIKE '%chandram%'`;
  console.log('Profiles for Chandram:', profiles);

  const allRoles = await sql`SELECT * FROM user_roles`;
  console.log('All user_roles:', allRoles);

  const orgs = await sql`SELECT * FROM organizations`;
  console.log('Organizations:', orgs);

  await sql.end();
}

main().catch(console.error);
