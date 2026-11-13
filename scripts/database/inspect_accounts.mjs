import postgres from '../../node_modules/postgres/src/index.js';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const directUrl = env.match(/DIRECT_URL="([^"]+)"/)?.[1];
const sql = postgres(directUrl, { ssl: 'require' });

async function main() {
  const accs = await sql`SELECT * FROM whatsapp_accounts`;
  console.log('ACCOUNTS COUNT:', accs.length);
  console.log('ACCOUNTS:', accs);

  const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='whatsapp_conversations'`;
  console.log('CONV COLS:', cols.map(c => c.column_name));

  const convs = await sql`SELECT id, customer_name, customer_phone, last_message FROM whatsapp_conversations LIMIT 5`;
  console.log('CONVS:', convs);

  await sql.end();
}

main().catch(console.error);
