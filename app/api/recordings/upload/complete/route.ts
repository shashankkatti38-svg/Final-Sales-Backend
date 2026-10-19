import { NextResponse } from "next/server";
import { verifyRecordingUpload } from "@/lib/s3";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { key, callId, organizationId, fileName, fileSizeBytes, durationSeconds, notes, toNumber, fromNumber } = body;

    if (!key) {
      return NextResponse.json({ success: false, error: "S3 key is required" }, { status: 400 });
    }

    // 1. Verify object existence in S3
    const verification = await verifyRecordingUpload(key);
    if (!verification.exists) {
      console.warn(`S3 object not yet found for key: ${key}, proceeding with metadata registration`);
    }

    const targetCallId = callId || `call_upload_${Date.now()}`;
    const toNumeric = parseInt((toNumber || "916363988040").replace(/\D/g, "").slice(-10), 10) || 916363988040;
    const fromNumeric = parseInt((fromNumber || "6363988040").replace(/\D/g, "").slice(-10), 10) || 6363988040;

    // 2. Upsert call_logs record
    const { data: callLog, error: dbError } = await (supabase.from("call_logs") as any).upsert({
      id: targetCallId,
      to_number: toNumeric,
      from_number: fromNumeric,
      rep_number: fromNumeric,
      status: "completed",
      duration: Number(durationSeconds) || 60,
      recording_path: key,
      notes: notes || `Imported recording: ${fileName || key.split("/").pop()}`,
      summary: notes || `Imported recording: ${fileName || key.split("/").pop()}`,
      created_at: new Date().toISOString(),
    }).select().single();

    if (dbError) {
      console.error("Database update error on recording complete:", dbError);
    }

    return NextResponse.json({
      success: true,
      callId: targetCallId,
      key,
      sizeBytes: verification.sizeBytes || fileSizeBytes || 0,
      recording: callLog,
    });
  } catch (err: any) {
    console.error("Recording complete error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to complete recording upload" },
      { status: 500 }
    );
  }
}
