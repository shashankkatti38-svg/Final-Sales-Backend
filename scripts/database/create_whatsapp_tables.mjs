import postgres from '../../node_modules/postgres/src/index.js';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const directUrl = env.match(/DIRECT_URL="([^"]+)"/)?.[1];
const sql = postgres(directUrl, { ssl: 'require' });

async function main() {
  console.log('Creating WhatsApp Shared Inbox tables safely in PostgreSQL...');

  // 1. WhatsApp Accounts Table
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS public.whatsapp_accounts (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      organization_id TEXT DEFAULT '4df15334-08f1-4ea8-a764-c36266fbfdba',
      phone_number TEXT NOT NULL,
      display_name TEXT NOT NULL,
      provider TEXT DEFAULT 'meta_cloud_api',
      status TEXT DEFAULT 'connected',
      quality_rating TEXT DEFAULT 'GREEN',
      is_default BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // 2. WhatsApp Conversations Table
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      organization_id TEXT DEFAULT '4df15334-08f1-4ea8-a764-c36266fbfdba',
      account_id TEXT,
      lead_id TEXT,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      last_message TEXT DEFAULT '',
      last_message_at TIMESTAMPTZ DEFAULT NOW(),
      unread_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'open',
      labels TEXT DEFAULT 'New Lead',
      assigned_to TEXT,
      is_pinned BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_whatsapp_conv_phone ON public.whatsapp_conversations(customer_phone);
    CREATE INDEX IF NOT EXISTS idx_whatsapp_conv_lead ON public.whatsapp_conversations(lead_id);
  `);

  // 3. WhatsApp Messages Table
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      organization_id TEXT DEFAULT '4df15334-08f1-4ea8-a764-c36266fbfdba',
      conversation_id TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
      message_type TEXT NOT NULL DEFAULT 'text',
      content TEXT NOT NULL,
      media_url TEXT,
      media_caption TEXT,
      status TEXT DEFAULT 'delivered',
      is_internal_note BOOLEAN DEFAULT false,
      sent_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_whatsapp_msg_conv ON public.whatsapp_messages(conversation_id);
  `);

  // 4. WhatsApp Templates Table
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      organization_id TEXT DEFAULT '4df15334-08f1-4ea8-a764-c36266fbfdba',
      name TEXT NOT NULL,
      category TEXT DEFAULT 'MARKETING',
      language TEXT DEFAULT 'en_US',
      status TEXT DEFAULT 'APPROVED',
      header TEXT,
      body TEXT NOT NULL,
      footer TEXT,
      buttons JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // 5. Enable RLS and Grant permissions
  await sql.unsafe(`
    ALTER TABLE public.whatsapp_accounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "whatsapp_accounts_org_policy" ON public.whatsapp_accounts;
    CREATE POLICY "whatsapp_accounts_org_policy" ON public.whatsapp_accounts
      FOR ALL TO authenticated USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "whatsapp_conv_org_policy" ON public.whatsapp_conversations;
    CREATE POLICY "whatsapp_conv_org_policy" ON public.whatsapp_conversations
      FOR ALL TO authenticated USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "whatsapp_msg_org_policy" ON public.whatsapp_messages;
    CREATE POLICY "whatsapp_msg_org_policy" ON public.whatsapp_messages
      FOR ALL TO authenticated USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "whatsapp_tmpl_org_policy" ON public.whatsapp_templates;
    CREATE POLICY "whatsapp_tmpl_org_policy" ON public.whatsapp_templates
      FOR ALL TO authenticated USING (true) WITH CHECK (true);

    GRANT ALL ON public.whatsapp_accounts TO authenticated, anon;
    GRANT ALL ON public.whatsapp_conversations TO authenticated, anon;
    GRANT ALL ON public.whatsapp_messages TO authenticated, anon;
    GRANT ALL ON public.whatsapp_templates TO authenticated, anon;
  `);

  // 6. Seed default WhatsApp accounts if empty
  const existingAccounts = await sql`SELECT COUNT(*) FROM public.whatsapp_accounts;`;
  if (parseInt(existingAccounts[0].count) === 0) {
    console.log('Seeding default WhatsApp business accounts...');
    const acc = await sql`
      INSERT INTO public.whatsapp_accounts (phone_number, display_name, provider, status, quality_rating, is_default)
      VALUES 
        ('+919876543210', 'SalesWorks360 Primary Support', 'meta_cloud_api', 'connected', 'GREEN', true),
        ('+919876543211', 'SalesWorks360 Inbound Sales', 'meta_cloud_api', 'connected', 'GREEN', false)
      RETURNING id, display_name;
    `;

    // Seed default approved templates
    await sql`
      INSERT INTO public.whatsapp_templates (name, category, language, status, header, body, footer, buttons)
      VALUES 
        ('lead_welcome_intro', 'MARKETING', 'en', 'APPROVED', 'Welcome to SalesWorks360', 'Hi {{name}}, thank you for reaching out to us. We have received your inquiry regarding {{requirement}}. Our sales specialist will assist you shortly.', 'Sales Works360 Integration', '[{"type":"QUICK_REPLY","text":"Chat with Rep"},{"type":"QUICK_REPLY","text":"Schedule Demo"}]'::jsonb),
        ('follow_up_proposal', 'UTILITY', 'en', 'APPROVED', 'Proposal Follow-up', 'Hi {{name}}, checking in on the proposal shared earlier for {{company}}. Let us know if you need any adjustments to the quotation.', 'SalesWorks360', '[{"type":"QUICK_REPLY","text":"Accept Proposal"},{"type":"QUICK_REPLY","text":"Request Callback"}]'::jsonb),
        ('meeting_reminder_15m', 'UTILITY', 'en', 'APPROVED', 'Upcoming Meeting Reminder', 'Reminder: Your scheduled demo with SalesWorks360 starts in 15 minutes. Click the link to join: {{link}}', 'Reply STOP to unsubscribe', '[{"type":"URL","text":"Join Meeting","url":"https://meet.google.com"}]'::jsonb);
    `;

    // Seed realistic conversations linked to existing leads
    const leads = await sql`SELECT id, name, phone, company, status, label FROM public.leads LIMIT 5;`;
    if (leads.length > 0) {
      console.log(`Seeding initial WhatsApp conversations for ${leads.length} leads...`);
      for (const lead of leads) {
        const conv = await sql`
          INSERT INTO public.whatsapp_conversations 
            (account_id, lead_id, customer_name, customer_phone, last_message, last_message_at, unread_count, status, labels, assigned_to, is_pinned)
          VALUES 
            (${acc[0].id}, ${lead.id}, ${lead.name}, ${lead.phone || '+919876543210'}, 'Hi, can you share the updated quotation with delivery timeline?', NOW() - interval '25 minutes', 1, 'open', ${lead.label || 'Hot Lead'}, 'Admin', ${lead.status === 'New'})
          RETURNING id;
        `;

        const convId = conv[0].id;
        // Seed conversation messages
        await sql`
          INSERT INTO public.whatsapp_messages 
            (conversation_id, direction, message_type, content, status, is_internal_note, created_at)
          VALUES
            (${convId}, 'inbound', 'text', 'Hello, I saw your CRM demo and want to learn more about pricing.', 'read', false, NOW() - interval '2 hours'),
            (${convId}, 'outbound', 'text', 'Hi ' || ${lead.name} || '! Thanks for reaching out. Are you looking for multi-user sales pipeline tracking and automated calling?', 'read', false, NOW() - interval '1 hour 45 minutes'),
            (${convId}, 'inbound', 'text', 'Yes, we have 15 sales reps who need native Android calling and WhatsApp shared inbox.', 'read', false, NOW() - interval '1 hour'),
            (${convId}, 'outbound', 'text', 'Perfect! SalesWorks360 supports native dual-SIM mobile calling and shared Meta WhatsApp Business API in one workspace.', 'delivered', false, NOW() - interval '40 minutes'),
            (${convId}, 'outbound', 'note', 'Client is comparing with Sales Works360. Prefers direct native SIM dialing.', 'delivered', true, NOW() - interval '30 minutes'),
            (${convId}, 'inbound', 'text', 'Hi, can you share the updated quotation with delivery timeline?', 'delivered', false, NOW() - interval '25 minutes');
        `;
      }
    }
  }

  console.log('WhatsApp tables created and seeded successfully!');
  await sql.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
