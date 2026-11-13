import postgres from '../../node_modules/postgres/src/index.js';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const directUrl = env.match(/DIRECT_URL="([^"]+)"/)?.[1];
const sql = postgres(directUrl, { ssl: 'require' });

async function checkRoles() {
  const distinctRoles = await sql`SELECT DISTINCT role FROM public.user_roles;`;
  console.log('Distinct roles in user_roles:', distinctRoles);

  const roleCheckConstraint = await sql`
    SELECT conname, pg_get_constraintdef(oid) 
    FROM pg_constraint 
    WHERE conrelid = 'public.user_roles'::regclass;
  `;
  console.log('user_roles constraints:', roleCheckConstraint);

  const allUserRoles = await sql`
    SELECT ur.user_id, ur.organization_id, ur.role, p.display_name, u.email
    FROM public.user_roles ur
    JOIN auth.users u ON u.id::text = ur.user_id
    LEFT JOIN public.profiles p ON p.id = ur.user_id;
  `;
  console.log('All user_roles with users:', allUserRoles);

  await sql.end();
}

checkRoles();
