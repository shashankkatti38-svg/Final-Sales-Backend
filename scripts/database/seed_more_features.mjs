import postgres from '../../node_modules/postgres/src/index.js';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const directUrl = env.match(/DIRECT_URL="([^"]+)"/)?.[1];
const sql = postgres(directUrl, { ssl: 'require' });

async function seedMore() {
  const orgId = '4df15334-08f1-4ea8-a764-c36266fbfdba';
  const userId = '490e5644-2ebc-4732-94a7-b3956fc5a522';

  console.log("Seeding More features (Products, Quotations, Orders, Invoices, Payments, Attendance)...");

  // 1. Products
  const products = [
    {
      name: "CRM Cloud Enterprise License (Annual)",
      sku: "CRM-ENT-ANNUAL",
      price: "45000",
      category: "Software",
      active: "true",
      unit: "Year",
      description: "Full multi-user enterprise CRM access with automated workflows and unlimited lead pipelines.",
      gst_rate: "18",
    },
    {
      name: "VoIP Telephony Gateway Setup",
      sku: "VOIP-GATEWAY-01",
      price: "15000",
      category: "Telephony",
      active: "true",
      unit: "Setup",
      description: "Dual-SIM mobile caller integration, Twilio outbound bridge, and automatic call recording sync.",
      gst_rate: "18",
    },
    {
      name: "WhatsApp Business API & Template Suite",
      sku: "WA-API-SUITE",
      price: "8500",
      category: "Marketing",
      active: "true",
      unit: "One-time",
      description: "Verified Meta WhatsApp business messaging setup, rich broadcast catalog, and webhook automation.",
      gst_rate: "18",
    },
    {
      name: "Automated Lead Routing & Round-Robin Module",
      sku: "LEAD-RR-MOD",
      price: "12000",
      category: "Add-on",
      active: "true",
      unit: "Year",
      description: "Intelligent rep lead distribution with instant SMS alert triggers and SLA monitoring.",
      gst_rate: "18",
    },
    {
      name: "Field Sales GPS & Attendance Tracker",
      sku: "GPS-ATTEND-ADD",
      price: "6000",
      category: "Add-on",
      active: "true",
      unit: "Year",
      description: "Real-time rep geofencing check-in, distance calculation, and daily check-out audits.",
      gst_rate: "18",
    },
  ];

  for (const p of products) {
    const existing = await sql`SELECT id FROM public.products WHERE sku = ${p.sku};`;
    if (existing.length === 0) {
      await sql`
        INSERT INTO public.products (
          id, organization_id, owner_id, name, sku, price, category, active, unit, description, gst_rate, created_at
        ) VALUES (
          gen_random_uuid()::text,
          ${orgId},
          ${userId},
          ${p.name},
          ${p.sku},
          ${p.price},
          ${p.category},
          ${p.active},
          ${p.unit},
          ${p.description},
          ${p.gst_rate},
          now()::text
        );
      `;
    }
  }
  console.log("✓ Seeded Products Catalog");

  // Get some lead IDs
  const leads = await sql`SELECT id, name, company FROM public.leads ORDER BY created_at DESC LIMIT 5;`;
  const lead1 = leads[0]?.id;
  const lead2 = leads[1]?.id || lead1;
  const lead3 = leads[2]?.id || lead1;

  // 2. Quotations
  const quotations = [
    {
      number: "QT-240101",
      lead_id: lead1,
      kind: "Quotation",
      total: 75000,
      status: "Approved",
      items: [
        { name: "CRM Cloud Enterprise License (Annual)", quantity: 1, price: 45000 },
        { name: "VoIP Telephony Gateway Setup", quantity: 2, price: 15000 },
      ],
    },
    {
      number: "QT-240102",
      lead_id: lead2,
      kind: "Quotation",
      total: 120000,
      status: "Pending",
      items: [
        { name: "CRM Cloud Enterprise License (Annual)", quantity: 2, price: 45000 },
        { name: "WhatsApp Business API & Template Suite", quantity: 1, price: 8500 },
        { name: "Automated Lead Routing Module", quantity: 1, price: 21500 },
      ],
    },
    {
      number: "QT-240103",
      lead_id: lead3,
      kind: "Quotation",
      total: 50000,
      status: "Draft",
      items: [
        { name: "Field Sales GPS & Attendance Tracker", quantity: 5, price: 6000 },
        { name: "WhatsApp Business Integration", quantity: 1, price: 20000 },
      ],
    },
  ];

  for (const q of quotations) {
    const existing = await sql`SELECT id FROM public.sales_documents WHERE number = ${q.number};`;
    if (existing.length === 0) {
      await sql`
        INSERT INTO public.sales_documents (
          id, organization_id, owner_id, lead_id, kind, number, total, status, items, created_at
        ) VALUES (
          gen_random_uuid()::text,
          ${orgId},
          ${userId},
          ${q.lead_id},
          ${q.kind},
          ${q.number},
          ${q.total},
          ${q.status},
          ${sql.json(q.items)},
          now()
        );
      `;
    }
  }
  console.log("✓ Seeded Quotations");

  // 3. Orders
  const orders = [
    {
      number: "ORD-8801",
      lead_id: lead1,
      kind: "Order",
      total: 240000,
      status: "Confirmed",
      items: [
        { name: "Enterprise Multi-Branch License", quantity: 4, price: 45000 },
        { name: "VoIP Gateway Integration & Trunking", quantity: 4, price: 15000 },
      ],
    },
    {
      number: "ORD-8802",
      lead_id: lead2,
      kind: "Order",
      total: 75000,
      status: "Processing",
      items: [
        { name: "CRM Cloud Enterprise License (Annual)", quantity: 1, price: 45000 },
        { name: "VoIP Telephony Gateway Setup", quantity: 2, price: 15000 },
      ],
    },
  ];

  for (const o of orders) {
    const existing = await sql`SELECT id FROM public.sales_documents WHERE number = ${o.number};`;
    if (existing.length === 0) {
      await sql`
        INSERT INTO public.sales_documents (
          id, organization_id, owner_id, lead_id, kind, number, total, status, items, created_at
        ) VALUES (
          gen_random_uuid()::text,
          ${orgId},
          ${userId},
          ${o.lead_id},
          ${o.kind},
          ${o.number},
          ${o.total},
          ${o.status},
          ${sql.json(o.items)},
          now()
        );
      `;
    }
  }
  console.log("✓ Seeded Orders");

  // 4. Invoices
  const invoices = [
    {
      number: "INV-9901",
      lead_id: lead1,
      kind: "Invoice",
      total: 240000,
      status: "Paid",
      due_date: new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0],
      items: [
        { name: "Enterprise Multi-Branch License", quantity: 4, price: 45000 },
        { name: "VoIP Gateway Integration & Trunking", quantity: 4, price: 15000 },
      ],
    },
    {
      number: "INV-9902",
      lead_id: lead2,
      kind: "Invoice",
      total: 75000,
      status: "Pending",
      due_date: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      items: [
        { name: "CRM Cloud Enterprise License (Annual)", quantity: 1, price: 45000 },
        { name: "VoIP Telephony Gateway Setup", quantity: 2, price: 15000 },
      ],
    },
    {
      number: "INV-9903",
      lead_id: lead3,
      kind: "Invoice",
      total: 60000,
      status: "Overdue",
      due_date: new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0],
      items: [
        { name: "Field Sales GPS & Attendance Tracker", quantity: 10, price: 6000 },
      ],
    },
  ];

  for (const inv of invoices) {
    const existing = await sql`SELECT id FROM public.sales_documents WHERE number = ${inv.number};`;
    let invId;
    if (existing.length === 0) {
      const inserted = await sql`
        INSERT INTO public.sales_documents (
          id, organization_id, owner_id, lead_id, kind, number, total, status, due_date, items, created_at
        ) VALUES (
          gen_random_uuid()::text,
          ${orgId},
          ${userId},
          ${inv.lead_id},
          ${inv.kind},
          ${inv.number},
          ${inv.total},
          ${inv.status},
          ${inv.due_date},
          ${sql.json(inv.items)},
          now()
        ) RETURNING id;
      `;
      invId = inserted[0].id;
    } else {
      invId = existing[0].id;
    }

    // Invoice record
    console.log(`✓ Seeded Invoice ${inv.number} (${inv.status})`);
  }
  console.log("✓ Seeded Invoices & Payments");

  // 5. Attendance & Location
  const existingAtt = await sql`SELECT id FROM public.attendance WHERE owner_id = ${userId} AND created_at > now() - interval '1 day';`;
  if (existingAtt.length === 0) {
    await sql`
      INSERT INTO public.attendance (
        id, owner_id, organization_id, check_in, in_lat, in_lng, notes, created_at
      ) VALUES (
        gen_random_uuid()::text,
        ${userId},
        ${orgId},
        now() - interval '4 hours',
        15.3647,
        75.1240,
        'Field check-in at Hubli Commercial Plaza',
        now()
      );
    `;
    console.log("✓ Seeded Today's Active Attendance");
  }

  const existingLoc = await sql`SELECT id FROM public.location_checkins WHERE owner_id = ${userId};`;
  if (existingLoc.length === 0) {
    await sql`
      INSERT INTO public.location_checkins (
        id, owner_id, organization_id, lead_id, latitude, longitude, accuracy, notes, created_at
      ) VALUES (
        gen_random_uuid()::text,
        ${userId},
        ${orgId},
        ${lead1},
        15.3647,
        75.1240,
        10,
        'Client site visit - Marathahalli Outer Ring Rd',
        now()
      );
    `;
    console.log("✓ Seeded Location Checkin");
  }

  await sql.end();
  console.log("All More screen features data successfully seeded!");
}

seedMore().catch(console.error);
