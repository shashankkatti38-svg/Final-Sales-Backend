import postgres from '../../node_modules/postgres/src/index.js';
import fs from 'fs';
const env = fs.readFileSync('.env', 'utf8');
const directUrl = env.match(/DIRECT_URL="([^"]+)"/)?.[1];
const sql = postgres(directUrl, { ssl: 'require' });

async function run() {
  const convs = await sql`SELECT id, customer_name, customer_phone, organization_id, lead_id FROM whatsapp_conversations`;
  console.log('whatsapp_conversations:', convs);
  await sql.end();
}
run();
