import postgres from '../../node_modules/postgres/src/index.js';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const directUrl = env.match(/DIRECT_URL="([^"]+)"/)?.[1];
const sql = postgres(directUrl, { ssl: 'require' });

async function checkAllUsers() {
  const users = await sql`
    SELECT u.id, u.email, p.display_name, r.organization_id, r.role
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id::text
    LEFT JOIN public.user_roles r ON r.user_id = u.id::text
    ORDER BY u.email;
  `;
  console.log('=== ALL USERS WITH ROLES ===');
  console.log(JSON.stringify(users, null, 2));

  // Also check if any user has NO user_roles
  const withoutRoles = await sql`
    SELECT u.id, u.email 
    FROM auth.users u 
    WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id::text);
  `;
  console.log('=== USERS WITHOUT ROLES ===', withoutRoles);

  // Check all organizations
  const orgs = await sql`SELECT * FROM public.organizations;`;
  console.log('=== ORGANIZATIONS ===', JSON.stringify(orgs, null, 2));

  await sql.end();
}

checkAllUsers();
