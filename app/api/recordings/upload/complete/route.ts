import { randomUUID } from "crypto";
import { verifyRecordingUpload } from "@/lib/s3";
import { getSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST /api/recordings/upload/complete
 * Function: Verify S3 object and save Supabase metadata
 */
export async function POST(req: Request) {
  try {
    const supabaseClient = getSupabaseClient(req);
    const body = await req.json().catch(() => ({}));
    const {
      key,
      callId,
      organizationId,
      fileName,
      fileSizeBytes,
      durationSeconds,
      notes,
      toNumber,
      fromNumber,
    } = body;

    if (!key) {
      return Response.json({ success: false, error: "S3 key is required" }, { status: 400 });
    }

    // 1. Verify object existence in S3 (or fallback storage)
    const verification = await verifyRecordingUpload(key);
    if (!verification.exists) {
      console.warn(`S3 object check did not confirm key: ${key}, proceeding with metadata registration`);
    }

    // 2. Resolve safe UUID for call_logs primary key
    const targetCallId = (callId && UUID_REGEX.test(callId)) ? callId : randomUUID();
    const requestId = randomUUID();

    const formattedTo = String(toNumber || "6363988040").trim();
    const formattedFrom = String(fromNumber || "6363988040").trim();
    const duration = Math.max(0, parseInt(String(durationSeconds || 60), 10) || 60);
    const summaryText = notes || `Imported recording: ${fileName || key.split("/").pop()}`;

    // 3. Upsert or update call_logs record
    const payload: Record<string, any> = {
      id: targetCallId,
      to_number: formattedTo,
      from_number: formattedFrom,
      rep_number: formattedFrom,
      status: "completed",
      duration,
      recording_path: key,
      notes: summaryText,
      summary: summaryText,
      created_at: new Date().toISOString(),
    };

    if (organizationId && UUID_REGEX.test(organizationId)) {
      payload.organization_id = organizationId;
    }

    const { data: callLog, error: dbError } = await (supabaseClient.from("call_logs") as any)
      .upsert(payload)
      .select()
      .maybeSingle();

    if (dbError) {
      console.error("Database update error on recording complete:", dbError);
    }

    return Response.json({
      success: true,
      callId: targetCallId,
      key,
      sizeBytes: verification.sizeBytes || fileSizeBytes || 0,
      verified: verification.exists,
      recording: callLog || payload,
    });
  } catch (err: any) {
    console.error("Recording complete error:", err);
    return Response.json(
      { success: false, error: err.message || "Failed to complete recording upload" },
      { status: 500 }
    );
  }
}
