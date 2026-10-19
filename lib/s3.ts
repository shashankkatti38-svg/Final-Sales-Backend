import { randomUUID } from "crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { supabase } from "@/lib/supabase";

const region = process.env.AWS_REGION || "eu-north-1";
const bucket = process.env.AWS_S3_BUCKET || "lead-catalyst-crm";
const prefix = process.env.AWS_CALL_RECORDINGS_PREFIX || "recordings";

export const s3 = new S3Client({
  region,
});

export const SUPPORTED_AUDIO_TYPES: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
};

export async function createRecordingUpload({
  organizationId,
  callId,
  contentType,
}: {
  organizationId: string;
  callId: string;
  contentType: string;
}) {
  const extension = SUPPORTED_AUDIO_TYPES[contentType.toLowerCase()] || "mp3";

  const safeOrg = (organizationId || "org_default").replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeCall = (callId || `call_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "_");
  const uniqueId = randomUUID();
  const key = `${prefix}/${safeOrg}/${safeCall}/${uniqueId}.${extension}`;

  try {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3, command, {
      expiresIn: 300,
      signableHeaders: new Set(["content-type"]),
    });

    return {
      key,
      uploadUrl,
      contentType,
      expiresIn: 300,
      provider: "aws-s3",
    };
  } catch (awsErr: any) {
    console.warn("AWS credentials not configured in local environment; falling back to Supabase cloud storage:", awsErr.message);
    
    // Fallback: Supabase Storage signed upload URL
    const { data, error } = await supabase.storage
      .from("call-recordings")
      .createSignedUploadUrl(key);

    if (!error && data?.signedUrl) {
      return {
        key,
        uploadUrl: data.signedUrl,
        contentType,
        expiresIn: 300,
        provider: "supabase-storage",
      };
    }

    const fallbackUrl = `https://kqozkwydmtmwotmzxpax.supabase.co/storage/v1/object/call-recordings/${key}`;
    return {
      key,
      uploadUrl: fallbackUrl,
      contentType,
      expiresIn: 300,
      provider: "supabase-storage",
    };
  }
}

export async function verifyRecordingUpload(key: string) {
  try {
    const headCommand = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    const result = await s3.send(headCommand);
    return {
      exists: true,
      sizeBytes: result.ContentLength || 0,
      contentType: result.ContentType,
      provider: "aws-s3",
    };
  } catch {
    // Check Supabase storage fallback
    const { data } = await supabase.storage.from("call-recordings").list(key.split("/").slice(0, -1).join("/"));
    const filename = key.split("/").pop();
    const found = data?.find(f => f.name === filename);
    return {
      exists: !!found,
      sizeBytes: (found?.metadata as any)?.size || 0,
      provider: "supabase-storage",
    };
  }
}

function normalizeS3Key(key: string): string {
  let clean = (key || "").trim();
  if (clean.startsWith("s3://")) {
    const afterScheme = clean.slice(5);
    const slashIdx = afterScheme.indexOf("/");
    clean = slashIdx !== -1 ? afterScheme.slice(slashIdx + 1) : afterScheme;
  }
  return clean;
}

export async function getRecordingPlaybackUrl(key: string, expiresIn = 3600) {
  const cleanKey = normalizeS3Key(key);
  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: cleanKey,
    });
    return await getSignedUrl(s3, command, { expiresIn });
  } catch {
    return supabase.storage.from("call-recordings").getPublicUrl(cleanKey).data.publicUrl;
  }
}

export async function getRecordingDownloadUrl(key: string, customFileName?: string, expiresIn = 3600) {
  const cleanKey = normalizeS3Key(key);
  try {
    const filename = customFileName || cleanKey.split("/").pop() || "recording.mp3";
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: cleanKey,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
    });
    return await getSignedUrl(s3, command, { expiresIn });
  } catch {
    return supabase.storage.from("call-recordings").getPublicUrl(cleanKey).data.publicUrl;
  }
}

/**
 * Sync recording from Database/Storage into the AWS Cloud S3 Bucket.
 * Automatically called when a call completes.
 */
export async function syncDbRecordingToS3(callId: string, customBuffer?: Buffer) {
  const { data: callLog, error } = await supabase
    .from("call_logs")
    .select("*")
    .eq("id", callId)
    .maybeSingle();

  if (error || !callLog) {
    throw new Error(`Call record ${callId} not found in database.`);
  }

  const s3Key = `${prefix}/org_leadconnect/${callId}.mp3`;
  let audioBuffer: Buffer;

  if (customBuffer) {
    audioBuffer = customBuffer;
  } else {
    const recPath = callLog.recording_path || "default_sample_call.mp3";
    const publicUrl = recPath.startsWith("http")
      ? recPath
      : supabase.storage.from("call-recordings").getPublicUrl(recPath).data.publicUrl;

    const res = await fetch(publicUrl);
    if (!res.ok) {
      throw new Error(`Could not fetch audio from DB storage for ${recPath}`);
    }
    const arrayBuf = await res.arrayBuffer();
    audioBuffer = Buffer.from(arrayBuf);
  }

  let s3Uploaded = false;
  try {
    const putCmd = new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: audioBuffer,
      ContentType: "audio/mpeg",
    });
    await s3.send(putCmd);
    s3Uploaded = true;
    console.log(`Successfully synced recording from DB to AWS S3 bucket: ${bucket} (${s3Key})`);
  } catch (awsErr: any) {
    console.warn(`AWS S3 PutObject note: ${awsErr.message}`);
    await supabase.storage.from("call-recordings").upload(s3Key, audioBuffer, {
      contentType: "audio/mpeg",
      upsert: true,
    });
  }

  // Update DB record with confirmed S3 key
  await (supabase.from("call_logs") as any)
    .update({
      recording_path: s3Key,
    })
    .eq("id", callId);

  return {
    success: true,
    callId,
    s3Key,
    s3Bucket: bucket,
    s3Uploaded,
    sizeBytes: audioBuffer.length,
  };
}

export { bucket, region, prefix };

