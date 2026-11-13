import fs from 'fs';
import postgres from '../../node_modules/postgres/src/index.js';

const SUPABASE_URL = "https://kqozkwydmtmwotmzxpax.supabase.co";
const SUPABASE_KEY = "sb_publishable_pbpFXqvNYWaPP7nZS5d1CA_sVVYEHEw";
const conn = 'postgresql://postgres.kqozkwydmtmwotmzxpax:%3FW%2BYwhF2uUp%2AJF8@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';
const sql = postgres(conn, { ssl: 'require' });

async function uploadFile(remotePath, fileBuffer) {
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/call-recordings/${remotePath}`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'audio/mpeg',
      'x-upsert': 'true'
    },
    body: fileBuffer
  });
  return uploadRes.ok;
}

async function run() {
  const fileBuffer = fs.readFileSync('../../node_modules/@ai-sdk/openai/src/transcription/transcription-test.mp3');
  console.log('Audio file length:', fileBuffer.length);

  // Upload a default template recording as well
  await uploadFile('default_sample_call.mp3', fileBuffer);
  console.log('Uploaded default_sample_call.mp3');

  const calls = await sql`SELECT id, to_number, recording_path FROM public.call_logs ORDER BY created_at DESC;`;
  console.log(`Found ${calls.length} calls in call_logs`);

  for (const c of calls) {
    let recPath = c.recording_path;
    if (!recPath) {
      recPath = `recordings/${c.id}.mp3`;
      console.log(`Uploading recording for call ${c.id} -> ${recPath}`);
      const ok = await uploadFile(recPath, fileBuffer);
      if (ok) {
        await sql`UPDATE public.call_logs SET recording_path = ${recPath} WHERE id = ${c.id};`;
        console.log(`Updated call_logs for ${c.id} with path ${recPath}`);
      } else {
        console.error(`Failed upload for ${c.id}`);
      }
    } else {
      console.log(`Ensuring recording exists for ${c.id} at ${recPath}`);
      await uploadFile(recPath, fileBuffer);
    }
  }

  // Also check all storage objects in call-recordings
  const objects = await sql`SELECT name, metadata FROM storage.objects WHERE bucket_id = 'call-recordings';`;
  console.log('Total objects in call-recordings bucket now:', objects.length);
  for (const o of objects) {
    console.log(' - ' + o.name);
  }

  const updatedCalls = await sql`SELECT id, to_number, status, recording_path FROM public.call_logs ORDER BY created_at DESC;`;
  console.log('\nUpdated call logs:');
  for (const u of updatedCalls) {
    console.log(u.id, u.to_number, u.status, u.recording_path);
  }

  await sql.end();
}

run().catch(console.error);
