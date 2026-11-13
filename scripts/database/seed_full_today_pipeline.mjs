import postgres from '../../node_modules/postgres/src/index.js';

const sql = postgres(process.env.DIRECT_URL, { ssl: 'require' });

async function seedPipeline() {
  const orgId = '4df15334-08f1-4ea8-a764-c36266fbfdba';
  const userId = '490e5644-2ebc-4732-94a7-b3956fc5a522';

  console.log("Seeding comprehensive today's CRM data...");

  // Keep existing 4 leads and add comprehensive today's leads across all pipeline stages
  const newLeads = [
    {
      name: "Vikram Malhotra",
      company: "Malhotra Infotech Solutions",
      email: "vikram@malhotratech.in",
      phone: "+919880123456",
      value: 75000,
      status: "Qualified",
      label: "Hot",
      source: "Website",
      contacted: true,
      address: "Prestige Tech Park, Marathahalli-Sarjapur Outer Ring Rd, Bengaluru",
    },
    {
      name: "Pooja Hegde",
      company: "Karnataka Agro Exports",
      email: "pooja.hegde@kaexports.com",
      phone: "+919741556677",
      value: 120000,
      status: "Proposal",
      label: "Hot",
      source: "Referral",
      contacted: true,
      address: "APMC Yard, Rayapur, Dharwad-Hubli Road",
    },
    {
      name: "Rahul Deshmukh",
      company: "Deshmukh Logistics & Cold Storage",
      email: "rahul@deshmukhlogistics.com",
      phone: "+919922334455",
      value: 240000,
      status: "Won",
      label: "Hot",
      source: "Direct",
      contacted: true,
      address: "Gokul Road Industrial Estate, Hubli",
    },
    {
      name: "Sneha Kulkarni",
      company: "Apex Healthcare Diagnostics",
      email: "sneha.k@apexdiagnostics.in",
      phone: "+919480112233",
      value: 50000,
      status: "Contacted",
      label: "Warm",
      source: "Google Ads",
      contacted: true,
      address: "Near KIMS Hospital, Vidyanagar, Hubli",
    },
    {
      name: "Arjun Rao",
      company: "CloudScale Systems Pvt Ltd",
      email: "arjun.rao@cloudscale.io",
      phone: "+919845098765",
      value: 180000,
      status: "Proposal",
      label: "Hot",
      source: "LinkedIn",
      contacted: true,
      address: "Electronic City Phase 1, Hosur Road, Bengaluru",
    },
    {
      name: "Kavita Patil",
      company: "Patil Educational Trust",
      email: "kavita.patil@patiledu.org",
      phone: "+919448877665",
      value: 35000,
      status: "New Inquiry",
      label: "Warm",
      source: "Direct",
      contacted: false,
      address: "BVB College Road, Vidyanagar, Hubli",
    },
    {
      name: "Anand Joshi",
      company: "Joshi Engineering Works",
      email: "anand.j@joshiengineering.co",
      phone: "+919823045678",
      value: 95000,
      status: "Requirement Gathering",
      label: "Warm",
      source: "Website",
      contacted: true,
      address: "Tarihal Industrial Area, Hubli",
    },
    {
      name: "Manish Sharma",
      company: "GreenLeaf Organic Mart",
      email: "manish@greenleafmart.in",
      phone: "+919876543210",
      value: 18000,
      status: "Lost",
      label: "Cold",
      source: "Cold Call",
      contacted: true,
      address: "Indiranagar 100ft Road, Bengaluru",
    },
    {
      name: "Divya Nambiar",
      company: "Zest Retail Chain",
      email: "divya@zestretail.com",
      phone: "+919945678901",
      value: 320000,
      status: "Won",
      label: "Hot",
      source: "Referral",
      contacted: true,
      address: "Koramangala 4th Block, Bengaluru",
    },
    {
      name: "Suresh Vernekar",
      company: "Vernekar Jewellers",
      email: "suresh@vernekarjewels.com",
      phone: "+919448001122",
      value: 85000,
      status: "Qualified",
      label: "Hot",
      source: "Direct",
      contacted: true,
      address: "Dajiban Peth, Hubli",
    }
  ];

  const insertedLeadIds = [];
  for (const l of newLeads) {
    const existing = await sql`SELECT id FROM public.leads WHERE phone = ${l.phone} OR (email = ${l.email} AND name = ${l.name});`;
    if (existing.length === 0) {
      const [row] = await sql`
        INSERT INTO public.leads (
          id, organization_id, owner_id, name, company, email, phone, value, status, label, source, address, created_at, contacted
        ) VALUES (
          gen_random_uuid()::text,
          ${orgId},
          ${userId},
          ${l.name},
          ${l.company},
          ${l.email},
          ${l.phone},
          ${l.value},
          ${l.status},
          ${l.label},
          ${l.source},
          ${l.address},
          now() - (interval '1 hour' * floor(random() * 8)),
          ${l.contacted ? 't' : 'f'}
        ) RETURNING id;
      `;
      insertedLeadIds.push({ id: row.id, name: l.name, phone: l.phone });
    } else {
      insertedLeadIds.push({ id: existing[0].id, name: l.name, phone: l.phone });
    }
  }

  console.log(`✓ Processed ${insertedLeadIds.length} pipeline leads for today`);

  // Today's Follow-up Tasks
  const taskData = [
    { title: "Follow-up proposal discussion with Vikram Malhotra", priority: "High", task_type: "Follow-up", due_hours: 2 },
    { title: "Send revised quotation to Pooja Hegde (Karnataka Agro)", priority: "High", task_type: "Quotation", due_hours: 4 },
    { title: "Final contract signature onboarding for Rahul Deshmukh", priority: "High", task_type: "Meeting", due_hours: 6 },
    { title: "Schedule VoIP phone demo with Sneha Kulkarni", priority: "Medium", task_type: "Demo", due_hours: 8 },
    { title: "Review cloud SLA requirements with Arjun Rao", priority: "Medium", task_type: "Call", due_hours: 12 },
    { title: "Check-in on Shashank KATTI (Lost lead recovery)", priority: "Low", task_type: "Follow-up", due_hours: 24 }
  ];

  for (const t of taskData) {
    const existingTask = await sql`SELECT id FROM public.tasks WHERE title = ${t.title};`;
    if (existingTask.length === 0) {
      await sql`
        INSERT INTO public.tasks (
          id, organization_id, owner_id, title, due_at, priority, completed, created_at, task_type, repeat
        ) VALUES (
          gen_random_uuid()::text,
          ${orgId},
          ${userId},
          ${t.title},
          now() + (interval '1 hour' * ${t.due_hours}),
          ${t.priority},
          'f',
          now(),
          ${t.task_type},
          'None'
        );
      `;
    }
  }
  console.log("✓ Added today's priority tasks & follow-ups");

  // Today's Call Logs
  const callData = [
    { rep: "919845395930", to: "+919880123456", duration: 184, status: "completed", lead_name: "Vikram Malhotra" },
    { rep: "919845395930", to: "+919741556677", duration: 312, status: "completed", lead_name: "Pooja Hegde" },
    { rep: "919845395930", to: "+919922334455", duration: 420, status: "completed", lead_name: "Rahul Deshmukh" },
    { rep: "919845395930", to: "+919480112233", duration: 95, status: "completed", lead_name: "Sneha Kulkarni" },
    { rep: "919845395930", to: "+916363988040", duration: 140, status: "completed", lead_name: "Shashank KATTI" }
  ];

  for (const c of callData) {
    const matchedLead = insertedLeadIds.find(l => l.name === c.lead_name);
    const existingCall = await sql`SELECT id FROM public.call_logs WHERE to_number = ${c.to} AND duration = ${String(c.duration)};`;
    if (existingCall.length === 0) {
      await sql`
        INSERT INTO public.call_logs (
          id, owner_id, organization_id, lead_id, status, from_number, rep_number, to_number, recording_consent, duration, created_at
        ) VALUES (
          gen_random_uuid()::text,
          ${userId},
          ${orgId},
          ${matchedLead ? matchedLead.id : null},
          ${c.status},
          '12602548883',
          ${c.rep},
          ${c.to},
          't',
          ${String(c.duration)},
          now() - (interval '1 hour' * floor(random() * 5 + 1))
        );
      `;
    }
  }
  console.log("✓ Added today's voice call logs with durations");

  // Today's Activities
  const activitiesData = [
    { type: "Call", notes: "Discussed custom enterprise pricing tier with Vikram Malhotra", hours_ago: 1 },
    { type: "Meeting", notes: "Demo completed for Pooja Hegde; client requested proposal document", hours_ago: 2 },
    { type: "Won", notes: "Closed deal with Rahul Deshmukh (₹2,40,000 contract value)", hours_ago: 3 },
    { type: "Note", notes: "Customer requested WhatsApp follow-up with catalog", hours_ago: 4 },
    { type: "Call", notes: "Inbound inquiry call answered from Sneha Kulkarni", hours_ago: 5 }
  ];

  for (const a of activitiesData) {
    const existingAct = await sql`SELECT id FROM public.activities WHERE notes = ${a.notes};`;
    if (existingAct.length === 0) {
      await sql`
        INSERT INTO public.activities (
          id, organization_id, owner_id, type, notes, occurred_at, created_at
        ) VALUES (
          gen_random_uuid()::text,
          ${orgId},
          ${userId},
          ${a.type},
          ${a.notes},
          now() - (interval '1 hour' * ${a.hours_ago}),
          now() - (interval '1 hour' * ${a.hours_ago})
        );
      `;
    }
  }
  console.log("✓ Added today's activity timeline entries");

  // Summary counts
  const totalLeads = await sql`SELECT count(*) FROM public.leads;`;
  const totalCalls = await sql`SELECT count(*) FROM public.call_logs;`;
  const totalTasks = await sql`SELECT count(*) FROM public.tasks;`;
  const totalActivities = await sql`SELECT count(*) FROM public.activities;`;

  console.log("\n=========================================");
  console.log(`TOTAL LEADS NOW:      ${totalLeads[0].count}`);
  console.log(`TOTAL CALL LOGS NOW:  ${totalCalls[0].count}`);
  console.log(`TOTAL TASKS NOW:      ${totalTasks[0].count}`);
  console.log(`TOTAL ACTIVITIES NOW: ${totalActivities[0].count}`);
  console.log("=========================================\n");

  await sql.end();
}

seedPipeline().catch(console.error);
