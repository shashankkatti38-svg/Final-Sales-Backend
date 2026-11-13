import postgres from '../../node_modules/postgres/src/index.js';
import dotenv from 'dotenv';
dotenv.config();
const connStr = process.env.DIRECT_URL;
const sql = postgres(connStr, { ssl: 'require' });

async function check() {
  const policies = await sql`
    SELECT tablename, policyname, cmd, qual
    FROM pg_policies
    WHERE schemaname = 'public';
  `;
  console.log("Current policies:", policies);
  await sql.end();
}

check().catch(console.error);
