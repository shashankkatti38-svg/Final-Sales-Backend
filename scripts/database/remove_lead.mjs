import postgres from '../../node_modules/postgres/src/index.js';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const directUrl = env.match(/DIRECT_URL="([^"]+)"/)?.[1];
const sql = postgres(directUrl, { ssl: 'require' });

async function removeLead() {
  const targetId = '445da2e6-ceb2-4e53-843b-779daed38df5';
  console.log('Deleting related records for lead:', targetId);
  await sql`DELETE FROM public.activities WHERE lead_id = ${targetId};`;
  await sql`DELETE FROM public.tasks WHERE lead_id = ${targetId};`;
  await sql`DELETE FROM public.call_logs WHERE lead_id = ${targetId};`;
  
  const deleted = await sql`
    DELETE FROM public.leads 
    WHERE id = ${targetId} OR (name = 'Shashank KATTI' AND status = 'Lost' AND value = 250)
    RETURNING id, name, status, value;
  `;
  console.log('✓ Successfully deleted lead from DB:', deleted);

  const remaining = await sql`
    SELECT id, name, status, value, label, created_at 
    FROM public.leads 
    ORDER BY created_at DESC;
  `;
  console.log(`\n=== REMAINING LEADS IN DB: ${remaining.length} ===`);
  console.table(remaining);

  await sql.end();
}

removeLead().catch(console.error);
