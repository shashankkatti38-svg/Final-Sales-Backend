import { NextResponse } from "next/server";
import { syncDbRecordingToS3 } from "@/lib/s3";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { callId } = body;

    if (!callId) {
      return NextResponse.json({ success: false, error: "callId is required" }, { status: 400 });
    }

    const result = await syncDbRecordingToS3(callId);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Sync call recording to S3 error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to sync recording to S3" },
      { status: 500 }
    );
  }
}
