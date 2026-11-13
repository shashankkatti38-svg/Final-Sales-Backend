import postgres from '../../node_modules/postgres/src/index.js';

const connStr = process.env.DIRECT_URL;
const sql = postgres(connStr, { ssl: 'require' });

async function syncDb() {
  const orgId = '4df15334-08f1-4ea8-a764-c36266fbfdba';
  const userId = '490e5644-2ebc-4732-94a7-b3956fc5a522';

  // 1. Ensure Shashank KATTI exists
  const existing = await sql`SELECT * FROM public.leads WHERE name = 'Shashank KATTI';`;
  let leadId;
  if (existing.length === 0) {
    const [inserted] = await sql`
      INSERT INTO public.leads (
        id, organization_id, owner_id, name, company, email, phone, value, status, label, source, address, created_at, contacted
      ) VALUES (
        gen_random_uuid()::text,
        ${orgId},
        ${userId},
        'Shashank KATTI',
        'Hubli',
        'shashankkatti32@gmail.com',
        '+916363988040',
        250,
        'Lost',
        'Hot',
        'Direct',
        'BMSIT BOY''S HOSTEL BLOCK B',
        now(),
        'f'
      ) RETURNING id;
    `;
    leadId = inserted.id;
    console.log("✓ Created Shashank KATTI lead:", leadId);
  } else {
    leadId = existing[0].id;
    console.log("✓ Shashank KATTI lead already exists:", leadId);
  }

  // 2. Ensure Tasks and Call Logs are assigned to org and user
  await sql`UPDATE public.tasks SET owner_id = ${userId} WHERE organization_id = ${orgId};`;
  await sql`UPDATE public.call_logs SET owner_id = ${userId} WHERE organization_id = ${orgId};`;

  // 3. Ensure an activity is logged for today
  const existingAct = await sql`SELECT * FROM public.activities WHERE lead_id = ${leadId};`;
  if (existingAct.length === 0) {
    await sql`
      INSERT INTO public.activities (
        id, organization_id, owner_id, lead_id, type, notes, occurred_at, created_at
      ) VALUES (
        gen_random_uuid()::text,
        ${orgId},
        ${userId},
        ${leadId},
        'Note',
        'Lead profile synchronized into LeadConnect Pro CRM pipeline',
        now()::text,
        now()::text
      );
    `;
    console.log("✓ Created activity log for lead");
  }

  // 4. Log summary of current leads
  const leads = await sql`SELECT id, name, company, email, phone, value, status, label, created_at FROM public.leads ORDER BY created_at DESC;`;
  console.log(`\n=== CURRENT TOTAL LEADS IN CRM (${leads.length}) ===`);
  for (const l of leads) {
    console.log(`- ${l.name} | ${l.company} | ${l.phone} | ₹${l.value} | Status: ${l.status} | Label: ${l.label}`);
  }

  await sql.end();
}

syncDb().catch(e => {
  console.error("Sync error:", e);
  process.exit(1);
});
