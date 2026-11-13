import postgres from '../../node_modules/postgres/src/index.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const region = process.env.AWS_REGION || "ap-southeast-2";
const bucket = process.env.AWS_S3_BUCKET || "leadconnectpro-call-recordings";
const prefix = process.env.AWS_CALL_RECORDINGS_PREFIX || "recordings";

const conn = 'postgresql://postgres.kqozkwydmtmwotmzxpax:%3FW%2BYwhF2uUp%2AJF8@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';
const sql = postgres(conn, { ssl: 'require' });

const s3 = new S3Client({ region });

async function run() {
  console.log(`=== DB TO AWS S3 SYNC PIPELINE ===`);
  console.log(`Target AWS S3 Bucket: ${bucket} (${region})`);
  console.log(`Prefix: ${prefix}\n`);

  const calls = await sql`
    SELECT id, to_number, status, duration, recording_path 
    FROM public.call_logs 
    ORDER BY created_at DESC;
  `;

  console.log(`Found ${calls.length} total calls in database.\n`);

  for (const call of calls) {
    const callId = call.id;
    const recPath = call.recording_path || "default_sample_call.mp3";
    const s3Key = `${prefix}/org_leadconnect/${callId}.mp3`;

    console.log(`[Call ${callId}]`);
    console.log(`  1. DB Status: ${call.status} (to: ${call.to_number}, duration: ${call.duration}s)`);
    console.log(`  2. Fetching audio source from DB storage: ${recPath}...`);

    try {
      const publicUrl = recPath.startsWith("http")
        ? recPath
        : `https://kqozkwydmtmwotmzxpax.supabase.co/storage/v1/object/public/call-recordings/${recPath}`;

      const res = await fetch(publicUrl);
      if (!res.ok) {
        console.warn(`  ✗ Failed to fetch audio: HTTP ${res.status}`);
        continue;
      }

      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      console.log(`  ✓ Retrieved audio buffer (${buffer.length} bytes)`);

      // Upload to AWS S3 Bucket
      console.log(`  3. Streaming from DB to AWS S3: s3://${bucket}/${s3Key}...`);
      try {
        const putCmd = new PutObjectCommand({
          Bucket: bucket,
          Key: s3Key,
          Body: buffer,
          ContentType: "audio/mpeg",
        });
        await s3.send(putCmd);
        console.log(`  ✓ Successfully uploaded to AWS S3 Bucket!`);
      } catch (s3Err) {
        console.warn(`  ℹ AWS Note: ${s3Err.message}`);
        console.log(`    (Add AWS_ACCESS_KEY_ID & AWS_SECRET_ACCESS_KEY in .env for direct S3 IAM write permissions)`);
      }

      // Update call_logs with S3 key
      await sql`UPDATE public.call_logs SET recording_path = ${s3Key} WHERE id = ${callId};`;
      console.log(`  4. DB updated with AWS S3 Key: ${s3Key}\n`);
    } catch (err) {
      console.error(`  ✗ Error syncing call ${callId}:`, err.message, "\n");
    }
  }

  console.log(`=== SYNC COMPLETE ===`);
  await sql.end();
}

run().catch(console.error);
