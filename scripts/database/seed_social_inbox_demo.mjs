import postgres from '../../node_modules/postgres/src/index.js';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const directUrl = env.match(/DIRECT_URL="([^"]+)"/)?.[1];
const sql = postgres(directUrl, { ssl: 'require' });

async function main() {
  console.log('Checking and seeding sample Instagram and Messenger conversations safely...');

  const orgId = '4df15334-08f1-4ea8-a764-c36266fbfdba';

  // Check if instagram account exists
  const igAccs = await sql`SELECT * FROM whatsapp_accounts WHERE channel = 'instagram' OR provider = 'meta_instagram'`;
  let igAccId = igAccs[0]?.id;
  if (!igAccId) {
    const [newIg] = await sql`
      INSERT INTO whatsapp_accounts (
        organization_id, phone_number, display_name, provider, channel, status, quality_rating, is_default
      ) VALUES (
        ${orgId}, '@salesworks360.crm', 'SalesWorks360 Official IG', 'meta_instagram', 'instagram', 'connected', 'GREEN', false
      ) RETURNING id;
    `;
    igAccId = newIg.id;
    console.log('Created sample connected Instagram account:', igAccId);
  }

  // Check if messenger account exists
  const msgAccs = await sql`SELECT * FROM whatsapp_accounts WHERE channel = 'messenger' OR provider = 'meta_messenger'`;
  let msgAccId = msgAccs[0]?.id;
  if (!msgAccId) {
    const [newMsg] = await sql`
      INSERT INTO whatsapp_accounts (
        organization_id, phone_number, display_name, provider, channel, status, quality_rating, is_default
      ) VALUES (
        ${orgId}, 'SalesWorks360 Business Page', 'SalesWorks360 Messenger', 'meta_messenger', 'messenger', 'connected', 'GREEN', false
      ) RETURNING id;
    `;
    msgAccId = newMsg.id;
    console.log('Created sample connected Messenger account:', msgAccId);
  }

  // Check leads to link
  const leads = await sql`SELECT id, name, phone FROM leads LIMIT 5`;
  const lead1 = leads[0]?.id;
  const lead2 = leads[1]?.id;

  // Check if Instagram conversation exists
  const existingIgConv = await sql`SELECT * FROM whatsapp_conversations WHERE channel = 'instagram'`;
  if (existingIgConv.length === 0) {
    const [igConv] = await sql`
      INSERT INTO whatsapp_conversations (
        organization_id, account_id, lead_id, customer_name, customer_phone,
        channel, handle, last_message, last_message_at, unread_count, status, labels, assigned_to
      ) VALUES (
        ${orgId}, ${igAccId}, ${lead1 || null}, 'Aarav Mehta', '@aarav.enterprise',
        'instagram', '@aarav.enterprise', 'Hey, I saw your product demo on Instagram reels, could you share the pricing for a team of 15?',
        NOW() - INTERVAL '15 minutes', 1, 'open', 'Hot Lead', 'Admin'
      ) RETURNING id;
    `;

    await sql`
      INSERT INTO whatsapp_messages (
        organization_id, conversation_id, direction, message_type, content, status, is_internal_note, sent_by, created_at, channel
      ) VALUES
      (${orgId}, ${igConv.id}, 'inbound', 'text', 'Hey, I saw your product demo on Instagram reels, could you share the pricing for a team of 15?', 'delivered', false, 'Aarav Mehta', NOW() - INTERVAL '15 minutes', 'instagram'),
      (${orgId}, ${igConv.id}, 'outbound', 'text', 'Hi Aarav! Thanks for reaching out. Yes, for 15 sales reps, our Business Tier includes automated call tracking and lead round-robin.', 'delivered', false, 'Admin', NOW() - INTERVAL '8 minutes', 'instagram');
    `;
    console.log('Created sample Instagram conversation and messages');
  }

  // Check if Messenger conversation exists
  const existingMsgConv = await sql`SELECT * FROM whatsapp_conversations WHERE channel = 'messenger'`;
  if (existingMsgConv.length === 0) {
    const [fbConv] = await sql`
      INSERT INTO whatsapp_conversations (
        organization_id, account_id, lead_id, customer_name, customer_phone,
        channel, handle, last_message, last_message_at, unread_count, status, labels, assigned_to
      ) VALUES (
        ${orgId}, ${msgAccId}, ${lead2 || null}, 'Priya Sharma', 'Priya Sharma (FB)',
        'messenger', 'priya.sharma.fb', 'Hi! Can we integrate SalesWorks360 with our Facebook ad lead forms directly?',
        NOW() - INTERVAL '30 minutes', 0, 'open', 'FB Ads Lead', 'Admin'
      ) RETURNING id;
    `;

    await sql`
      INSERT INTO whatsapp_messages (
        organization_id, conversation_id, direction, message_type, content, status, is_internal_note, sent_by, created_at, channel
      ) VALUES
      (${orgId}, ${fbConv.id}, 'inbound', 'text', 'Hi! Can we integrate SalesWorks360 with our Facebook ad lead forms directly?', 'read', false, 'Priya Sharma', NOW() - INTERVAL '30 minutes', 'messenger'),
      (${orgId}, ${fbConv.id}, 'outbound', 'text', 'Hello Priya! Absolutely, our webhooks capture Facebook instant forms in real time and instantly notify the assigned rep.', 'read', false, 'Admin', NOW() - INTERVAL '25 minutes', 'messenger'),
      (${orgId}, ${fbConv.id}, 'outbound', 'note', '[Internal Note] Priya is the VP Marketing at TechVenture India. Follow up tomorrow with API docs.', 'delivered', true, 'Admin', NOW() - INTERVAL '20 minutes', 'messenger');
    `;
    console.log('Created sample Facebook Messenger conversation and messages');
  }

  console.log('Seeding completed successfully.');
  await sql.end();
}

main().catch(console.error);
