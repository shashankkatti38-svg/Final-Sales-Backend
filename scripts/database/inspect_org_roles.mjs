import postgres from '../../node_modules/postgres/src/index.js';
import fs from 'fs';
const env = fs.readFileSync('.env', 'utf8');
const directUrl = env.match(/DIRECT_URL="([^"]+)"/)?.[1];
const sql = postgres(directUrl, { ssl: 'require' });

async function run() {
  console.log('--- USER ROLES ---');
  const roles = await sql`
    SELECT ur.user_id, ur.organization_id, ur.role, p.display_name, o.name as org_name
    FROM user_roles ur
    LEFT JOIN profiles p ON p.id = ur.user_id
    LEFT JOIN organizations o ON o.id = ur.organization_id
  `;
  console.log(roles);

  console.log('--- LEADS COUNT BY ORG ---');
  const leadCounts = await sql`
    SELECT organization_id, count(*) 
    FROM leads 
    GROUP BY organization_id
  `;
  console.log(leadCounts);

  await sql.end();
}
run();
