import postgres from '../../node_modules/postgres/src/index.js';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const directUrl = env.match(/DIRECT_URL="([^"]+)"/)?.[1];
const sql = postgres(directUrl, { ssl: 'require' });

async function main() {
  console.log('Adding optional channel and metadata columns to inbox tables safely...');

  await sql.unsafe(`
    ALTER TABLE public.whatsapp_accounts ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'whatsapp';
    ALTER TABLE public.whatsapp_accounts ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
    
    ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'whatsapp';
    ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS handle TEXT;
    
    ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'whatsapp';
  `);

  console.log('Columns added successfully.');

  // Let's check if we have any instagram or messenger accounts, if not let's check
  const accounts = await sql`SELECT id, display_name, provider, channel, status FROM public.whatsapp_accounts`;
  console.log('Current Accounts:', accounts);

  await sql.end();
}

main().catch(console.error);
