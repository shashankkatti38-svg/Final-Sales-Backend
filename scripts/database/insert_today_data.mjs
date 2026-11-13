import postgres from '../../node_modules/postgres/src/index.js';
const connStr = process.env.DIRECT_URL;
const sql = postgres(connStr, { ssl: 'require' });

async function insertTodayData() {
  const userId = '490e5644-2ebc-4732-94a7-b3956fc5a522'; // shashankkatti32@gmail.com
  const orgId = '4df15334-08f1-4ea8-a764-c36266fbfdba';

  // 1. Insert today's lead from the screenshot
  const insertedLead = await sql`
    INSERT INTO public.leads (
      id,
      organization_id,
      owner_id,
      name,
      company,
      email,
      phone,
      value,
      status,
      label,
      source,
      address,
      created_at,
      contacted
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
    )
    RETURNING *;
  `;
  console.log("✓ Today's lead inserted successfully:", insertedLead[0]);

  // 2. Also ensure all tasks and calls are owned by the active user in the organization
  await sql`
    UPDATE public.tasks
    SET owner_id = ${userId}
    WHERE organization_id = ${orgId}
  `;
  await sql`
    UPDATE public.call_logs
    SET owner_id = ${userId}
    WHERE organization_id = ${orgId}
  `;
  console.log("✓ Tasks and Call logs reallocated to current user");

  // 3. Insert an activity record for today's lead creation
  await sql`
    INSERT INTO public.activities (
      id,
      organization_id,
      owner_id,
      lead_id,
      type,
      notes,
      occurred_at,
      created_at
    ) VALUES (
      gen_random_uuid()::text,
      ${orgId},
      ${userId},
      ${insertedLead[0].id},
      'Note',
      'Lead added via LeadConnect Mobile & Web workspace',
      now()::text,
      now()::text
    )
  `;
  console.log("✓ Activity for today's lead created");

  const allLeads = await sql`SELECT id, name, company, email, phone, value, status, label, created_at FROM public.leads ORDER BY created_at DESC;`;
  console.log(`Current total leads in database (${allLeads.length}):`);
  console.log(allLeads);

  await sql.end();
}

insertTodayData().catch(console.error);
