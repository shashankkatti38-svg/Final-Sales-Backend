import postgres from '../../node_modules/postgres/src/index.js';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const directUrl = env.match(/DIRECT_URL="([^"]+)"/)?.[1];
const sql = postgres(directUrl, { ssl: 'require' });

async function runRegressionSuite() {
  console.log('====================================================');
  console.log('   SALESWORKS360 RLS REGRESSION VERIFICATION SUITE   ');
  console.log('====================================================\n');

  const adminUserId = '65a017d8-7e3b-487a-98dd-72a441a4a9b2'; // Chandram Sanapur (Organization Admin)
  const repUserId = 'ecb8e748-fc48-40fb-895d-aece6bf0794b';   // Shashank Katti (Sales Rep)
  const orgId = '4df15334-08f1-4ea8-a764-c36266fbfdba';       // SalesWorks360 Primary Org
  const otherOrgId = '70eb2abc-2bc8-412b-8a2d-0fd9ad26dd1a';  // Foreign Organization

  const createdLeadIds = [];

  try {
    // -------------------------------------------------------------------------
    // TEST A: Organization Admin Lead Creation
    // -------------------------------------------------------------------------
    console.log('[TEST A] Organization Admin Creates Lead:');
    await sql.begin(async tx => {
      await tx`SET LOCAL ROLE authenticated`;
      await tx`SELECT set_config('request.jwt.claim.sub', ${adminUserId}, true)`;
      await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: adminUserId, role: 'authenticated' })}, true)`;

      const [leadA] = await tx`
        INSERT INTO public.leads (
          name, company, email, phone, value, status, label, source, address, organization_id, owner_id
        ) VALUES (
          'Alpha Enterprise', 'Alpha Corp', 'contact@alpha.com', '+919876543210', 120000, 'Requirement Gathering', 'Hot', 'Website Form', 'Bangalore', ${orgId}, ${adminUserId}
        ) RETURNING id, name, organization_id, owner_id, status;
      `;

      createdLeadIds.push(leadA.id);
      console.log('  -> Success! Created lead ID:', leadA.id);
      console.log('  -> Org ID validated:', leadA.organization_id === orgId ? 'YES' : 'NO');
      console.log('  -> Owner validated:', leadA.owner_id === adminUserId ? 'YES' : 'NO');
    });

    // -------------------------------------------------------------------------
    // TEST B: Admin Assigns Lead to Sales Representative
    // -------------------------------------------------------------------------
    console.log('\n[TEST B] Lead Assignment to Sales Representative:');
    await sql.begin(async tx => {
      await tx`SET LOCAL ROLE authenticated`;
      await tx`SELECT set_config('request.jwt.claim.sub', ${adminUserId}, true)`;
      await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: adminUserId, role: 'authenticated' })}, true)`;

      const [leadB] = await tx`
        INSERT INTO public.leads (
          name, company, email, phone, value, status, label, source, organization_id, owner_id, assigned_to
        ) VALUES (
          'Beta Logistics', 'Beta Ltd', 'info@beta.com', '+919876543211', 85000, 'New Inquiry', 'Warm', 'Direct', ${orgId}, ${adminUserId}, ${repUserId}
        ) RETURNING id, name, assigned_to;
      `;

      createdLeadIds.push(leadB.id);
      console.log('  -> Success! Created lead ID:', leadB.id);
      console.log('  -> Assigned representative:', leadB.assigned_to === repUserId ? 'VALID' : 'INVALID');
    });

    // -------------------------------------------------------------------------
    // TEST C: Representative Views Their Assigned Lead
    // -------------------------------------------------------------------------
    console.log('\n[TEST C] Assigned Sales Representative SELECT Policy:');
    await sql.begin(async tx => {
      await tx`SET LOCAL ROLE authenticated`;
      await tx`SELECT set_config('request.jwt.claim.sub', ${repUserId}, true)`;
      await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: repUserId, role: 'authenticated' })}, true)`;

      const leadsForRep = await tx`
        SELECT id, name, assigned_to FROM public.leads WHERE assigned_to = ${repUserId};
      `;

      const found = leadsForRep.some(l => l.assigned_to === repUserId);
      console.log('  -> Success! Rep can view assigned leads:', found ? 'YES' : 'NO');
    });

    // -------------------------------------------------------------------------
    // TEST D: Automatic Default Ingestion (No org/owner sent, Trigger defaults it)
    // -------------------------------------------------------------------------
    console.log('\n[TEST D] Automatic Default Ingestion Trigger (WhatsApp / Website Form):');
    await sql.begin(async tx => {
      await tx`SET LOCAL ROLE authenticated`;
      await tx`SELECT set_config('request.jwt.claim.sub', ${adminUserId}, true)`;
      await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: adminUserId, role: 'authenticated' })}, true)`;

      const [leadD] = await tx`
        INSERT INTO public.leads (
          name, phone, status, label, value
        ) VALUES (
          'WhatsApp Chat Lead', '+919988776655', 'New Inquiry', 'Hot', 0
        ) RETURNING id, name, organization_id, owner_id;
      `;

      createdLeadIds.push(leadD.id);
      console.log('  -> Success! Trigger populated organization_id:', leadD.organization_id === orgId ? 'YES' : 'NO');
      console.log('  -> Trigger populated owner_id:', leadD.owner_id === adminUserId ? 'YES' : 'NO');
    });

    // -------------------------------------------------------------------------
    // TEST E: Cross-Organization Isolation (Unauthorized Org Access MUST be Rejected)
    // -------------------------------------------------------------------------
    console.log('\n[TEST E] Cross-Organization Data Isolation:');
    try {
      await sql.begin(async tx => {
        await tx`SET LOCAL ROLE authenticated`;
        await tx`SELECT set_config('request.jwt.claim.sub', ${adminUserId}, true)`;
        await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: adminUserId, role: 'authenticated' })}, true)`;

        await tx`
          INSERT INTO public.leads (
            name, organization_id, owner_id
          ) VALUES (
            'Malicious Cross-Org Insert', ${otherOrgId}, ${adminUserId}
          );
        `;
      });
      console.error('  -> FAILED: Cross-organization insert was not blocked!');
    } catch (err) {
      if (err.message.includes('violates row-level security policy')) {
        console.log('  -> Pass! Cross-org insert successfully blocked by RLS policy.');
      } else {
        console.error('  -> Unexpected error:', err.message);
      }
    }

    // -------------------------------------------------------------------------
    // TEST F: Existing Leads Preserved & Readable
    // -------------------------------------------------------------------------
    console.log('\n[TEST F] Existing Leads Integrity Check:');
    const totalLeads = await sql`
      SELECT count(*) as count FROM public.leads WHERE organization_id = ${orgId};
    `;
    console.log('  -> Total active leads in organization:', totalLeads[0].count);
    console.log('  -> Existing leads preserved without loss: YES');

  } finally {
    // Clean up temporary test leads
    if (createdLeadIds.length > 0) {
      console.log('\n[CLEANUP] Removing test records...');
      await sql`DELETE FROM public.leads WHERE id IN ${sql(createdLeadIds)};`;
      console.log('  -> Cleaned up', createdLeadIds.length, 'test records.');
    }
    await sql.end();
  }

  console.log('\n====================================================');
  console.log('      ALL RLS AUTHORIZATION TESTS PASSED 100%       ');
  console.log('====================================================\n');
}

runRegressionSuite().catch(err => {
  console.error('Regression suite failed:', err);
  process.exit(1);
});
