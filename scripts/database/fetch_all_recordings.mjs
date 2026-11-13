import fs from 'fs';
import path from 'path';
import postgres from '../../node_modules/postgres/src/index.js';

const SUPABASE_URL = "https://kqozkwydmtmwotmzxpax.supabase.co";
const conn = 'postgresql://postgres.kqozkwydmtmwotmzxpax:%3FW%2BYwhF2uUp%2AJF8@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';
const sql = postgres(conn, { ssl: 'require' });

const TARGET_DIR = path.resolve('call recordings');

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
  return arrayBuffer.byteLength;
}

async function run() {
  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
    console.log(`Created folder: ${TARGET_DIR}`);
  }

  // 1. Fetch all storage objects in call-recordings bucket
  const storageObjects = await sql`
    SELECT name, bucket_id, created_at, metadata 
    FROM storage.objects 
    WHERE bucket_id = 'call-recordings'
    ORDER BY created_at DESC;
  `;
  console.log(`Found ${storageObjects.length} storage objects in 'call-recordings' bucket`);

  // 2. Fetch all call logs from DB
  const callLogs = await sql`
    SELECT id, to_number, from_number, status, duration, recording_path, notes, summary, created_at 
    FROM public.call_logs 
    ORDER BY created_at DESC;
  `;
  console.log(`Found ${callLogs.length} call logs in database`);

  const manifest = [];

  // 3. Download each storage object
  for (const obj of storageObjects) {
    const rawPath = obj.name;
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/call-recordings/${encodeURIComponent(rawPath).replace(/%2F/g, '/')}`;

    // Find linked call log
    const linkedCall = callLogs.find(c => c.recording_path === rawPath);
    
    // Choose clean readable filename
    let cleanFileName = path.basename(rawPath);
    if (linkedCall) {
      cleanFileName = `call_${linkedCall.id}_to_${linkedCall.to_number || 'unknown'}.mp3`;
    }

    const destPath = path.join(TARGET_DIR, cleanFileName);
    console.log(`Downloading: ${rawPath} -> ${cleanFileName}...`);

    try {
      const size = await downloadFile(publicUrl, destPath);
      console.log(`  ✓ Saved ${cleanFileName} (${size} bytes)`);

      manifest.push({
        fileName: cleanFileName,
        storagePath: rawPath,
        publicUrl,
        sizeBytes: size,
        callId: linkedCall?.id || null,
        toNumber: linkedCall?.to_number || null,
        fromNumber: linkedCall?.from_number || null,
        status: linkedCall?.status || 'stored',
        duration: linkedCall?.duration || null,
        notes: linkedCall?.notes || linkedCall?.summary || null,
        createdAt: linkedCall?.created_at || obj.created_at,
      });
    } catch (err) {
      console.error(`  ✗ Error downloading ${rawPath}:`, err.message);
    }
  }

  // Save manifest.json
  const manifestPath = path.join(TARGET_DIR, 'recordings_manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`Saved manifest to: ${manifestPath}`);

  // Create a markdown index for quick viewing
  let md = `# Call Recordings Catalog\n\n`;
  md += `Exported on: ${new Date().toLocaleString()}\n`;
  md += `Total Recordings: ${manifest.length}\n\n`;
  md += `| File Name | Recipient | Status | Duration | Size | Cloud Link |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  for (const item of manifest) {
    const dur = item.duration ? `${item.duration}s` : 'N/A';
    const to = item.toNumber ? `+${item.toNumber}` : 'N/A';
    const sz = `${(item.sizeBytes / 1024).toFixed(1)} KB`;
    md += `| \`${item.fileName}\` | **${to}** | \`${item.status}\` | ${dur} | ${sz} | [Stream URL](${item.publicUrl}) |\n`;
  }

  const mdPath = path.join(TARGET_DIR, 'README.md');
  fs.writeFileSync(mdPath, md, 'utf-8');
  console.log(`Saved markdown catalog to: ${mdPath}`);

  await sql.end();
}

run().catch(console.error);
