import postgres from '../../node_modules/postgres/src/index.js';
import fs from 'fs';
import crypto from 'crypto';

const env = fs.readFileSync('.env', 'utf8');
const directUrl = env.match(/DIRECT_URL="([^"]+)"/)?.[1];
const sql = postgres(directUrl, { ssl: 'require' });

async function insertNewLeads() {
  const orgId = '4df15334-08f1-4ea8-a764-c36266fbfdba';
  const ownerId = '490e5644-2ebc-4732-94a7-b3956fc5a522';

  // Base timestamps for today (2026-10-16) matching screenshot times
  const today = '2026-10-16';
  const lakshmiTime = `${today}T14:30:00.000Z`;
  const shashankTime = `${today}T14:14:00.000Z`;
  const hembabuTime = `${today}T10:32:00.000Z`;

  console.log("Cleaning any previous incomplete screenshot inserts...");
  await sql`DELETE FROM public.leads WHERE name IN ('Lakshmi', 'Shashank Dhananjay KATTI', 'Hembabu');`;

  console.log("Inserting new screenshot leads into database...");

  // 1. Lakshmi
  const [leadLakshmi] = await sql`
    INSERT INTO public.leads (
      organization_id, owner_id, name, company, email, phone, value, status, label, source, contacted, created_at
    ) VALUES (
      ${orgId}, ${ownerId}, 'Lakshmi', 'Hubli', 'lakshmi@example.com', '+919845012345', 0, 'New Inquiry', 'Warm', 'Direct', 'f', ${lakshmiTime}
    )
    RETURNING id;
  `;
  console.log("Inserted Lakshmi:", leadLakshmi.id);

  await sql`
    INSERT INTO public.activities (
      id, organization_id, owner_id, lead_id, type, notes, occurred_at
    ) VALUES (
      ${crypto.randomUUID()}, ${orgId}, ${ownerId}, ${leadLakshmi.id}, 'update', 'Updated lead status to New Inquiry', ${lakshmiTime}
    );
  `;

  // 2. Shashank Dhananjay KATTI
  const [leadShashank] = await sql`
    INSERT INTO public.leads (
      organization_id, owner_id, name, company, email, phone, value, status, label, source, contacted, created_at
    ) VALUES (
      ${orgId}, ${ownerId}, 'Shashank Dhananjay KATTI', 'KATTI Enterprises', 'shashank.d.katti@gmail.com', '+916363988040', 5000, 'Delivered', 'Hot', 'Direct', 't', ${shashankTime}
    )
    RETURNING id;
  `;
  console.log("Inserted Shashank Dhananjay KATTI:", leadShashank.id);

  await sql`
    INSERT INTO public.activities (
      id, organization_id, owner_id, lead_id, type, notes, occurred_at
    ) VALUES (
      ${crypto.randomUUID()}, ${orgId}, ${ownerId}, ${leadShashank.id}, 'note', 'Order delivered and verified', ${shashankTime}
    );
  `;

  // 3. Hembabu
  const [leadHembabu] = await sql`
    INSERT INTO public.leads (
      organization_id, owner_id, name, company, email, phone, value, status, label, source, contacted, created_at
    ) VALUES (
      ${orgId}, ${ownerId}, 'Hembabu', 'Hembabu Tech', 'hembabu@example.com', '+919988776655', 500, 'Testing', 'Hot', 'Direct', 'f', ${hembabuTime}
    )
    RETURNING id;
  `;
  console.log("Inserted Hembabu:", leadHembabu.id);

  await sql`
    INSERT INTO public.activities (
      id, organization_id, owner_id, lead_id, type, notes, occurred_at
    ) VALUES (
      ${crypto.randomUUID()}, ${orgId}, ${ownerId}, ${leadHembabu.id}, 'update', 'Testing pipeline lead verification', ${hembabuTime}
    );
  `;

  console.log("✓ All screenshot leads and activities inserted successfully!");

  const allLeads = await sql`SELECT id, name, status, value, label, created_at FROM public.leads ORDER BY created_at DESC;`;
  console.log(`\n=== TOTAL LEADS IN DB: ${allLeads.length} ===`);
  console.table(allLeads);

  await sql.end();
}

insertNewLeads().catch(console.error);
