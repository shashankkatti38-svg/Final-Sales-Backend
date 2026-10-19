import { NextResponse } from "next/server";
import { createRecordingUpload, SUPPORTED_AUDIO_TYPES } from "@/lib/s3";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { organizationId, callId, contentType, fileName, fileSizeBytes } = body;

    if (!contentType) {
      return NextResponse.json(
        { success: false, error: "contentType is required (e.g. audio/mpeg, audio/mp4, audio/wav)" },
        { status: 400 }
      );
    }

    const normalizedType = contentType.toLowerCase().trim();
    if (!SUPPORTED_AUDIO_TYPES[normalizedType]) {
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported audio type '${contentType}'. Allowed types: MP3, M4A, WAV, AAC, OGG`,
        },
        { status: 400 }
      );
    }

    // Enforce 100MB max file size
    if (fileSizeBytes && fileSizeBytes > 100 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: "Recording exceeds maximum allowed size of 100MB" },
        { status: 400 }
      );
    }

    const orgId = organizationId || "org_default";
    const callLogId = callId || `call_${Date.now()}`;

    const uploadInfo = await createRecordingUpload({
      organizationId: orgId,
      callId: callLogId,
      contentType: normalizedType,
    });

    return NextResponse.json({
      success: true,
      key: uploadInfo.key,
      uploadUrl: uploadInfo.uploadUrl,
      contentType: uploadInfo.contentType,
      expiresIn: uploadInfo.expiresIn,
    });
  } catch (err: any) {
    console.error("Recording initiate error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to generate presigned upload URL" },
      { status: 500 }
    );
  }
}
