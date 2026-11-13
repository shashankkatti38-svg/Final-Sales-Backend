import postgres from '../../node_modules/postgres/src/index.js';
import fs from 'fs';
const env = fs.readFileSync('.env', 'utf8');
const directUrl = env.match(/DIRECT_URL="([^"]+)"/)?.[1];
const sql = postgres(directUrl, { ssl: 'require' });

async function run() {
  const policies = await sql`
    SELECT tablename, policyname, roles, cmd, qual, with_check 
    FROM pg_policies 
    WHERE tablename IN ('whatsapp_conversations', 'whatsapp_accounts', 'whatsapp_messages')
  `;
  console.log(policies);
  await sql.end();
}
run();
