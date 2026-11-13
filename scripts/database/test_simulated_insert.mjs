import postgres from '../../node_modules/postgres/src/index.js';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const directUrl = env.match(/DIRECT_URL="([^"]+)"/)?.[1];
const sql = postgres(directUrl, { ssl: 'require' });

async function testInsert() {
  const userId = '65a017d8-7e3b-487a-98dd-72a441a4a9b2'; // Chandram Sanapur
  
  try {
    await sql.begin(async sql => {
      // Set the local auth state as Supabase PostgREST does
      await sql`SET LOCAL ROLE authenticated;`;
      await sql`SELECT set_config('request.jwt.claim.sub', ${userId}, true);`;
      await sql`SELECT set_config('request.jwt.claim.role', 'authenticated', true);`;
      await sql`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true);`;

      const currentAuthUid = await sql`SELECT auth.uid() as uid;`;
      console.log('auth.uid():', currentAuthUid);

      const orgRes = await sql`SELECT public.crm_org() as org;`;
      console.log('public.crm_org():', orgRes);

      const adminRes = await sql`SELECT public.crm_is_admin() as is_admin;`;
      console.log('public.crm_is_admin():', adminRes);

      // Now attempt the exact insert payload from the frontend Quick Add:
      console.log('Attempting INSERT...');
      const insertRes = await sql`
        INSERT INTO public.leads (
          name, company, email, phone, value, status, label, source, address, owner_id
        ) VALUES (
          'sdsfsf', 'Fuelo Technologies OPC Pvt Ltd', 'admin@primepro.ai', '+91 99869 56470', 50000, 'Requirement Gathering', 'Warm', 'Website Form', 'Bangalore', ${userId}
        ) RETURNING *;
      `;
      console.log('Insert SUCCESS:', insertRes);
      
      // Rollback so we don't pollute unless we want to
      throw new Error('ROLLBACK_TEST');
    });
  } catch (err) {
    if (err.message === 'ROLLBACK_TEST') {
      console.log('Test completed successfully and rolled back.');
    } else {
      console.error('Insert FAILED with error:');
      console.error(err);
    }
  }

  await sql.end();
}

testInsert();
