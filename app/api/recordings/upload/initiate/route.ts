import { createRecordingUpload, SUPPORTED_AUDIO_TYPES } from "@/lib/s3";

export const dynamic = "force-dynamic";

/**
 * POST /api/recordings/upload/initiate
 * Function: Generate authorized upload URL (presigned S3 PutObject or signed Supabase upload URL)
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { organizationId, callId, contentType, fileName, fileSizeBytes } = body;

    if (!contentType) {
      return Response.json(
        { success: false, error: "contentType is required (e.g. audio/mpeg, audio/mp4, audio/wav)" },
        { status: 400 }
      );
    }

    const normalizedType = String(contentType).toLowerCase().trim();
    if (!SUPPORTED_AUDIO_TYPES[normalizedType]) {
      return Response.json(
        {
          success: false,
          error: `Unsupported audio type '${contentType}'. Allowed types: MP3, M4A, WAV, AAC, OGG, WEBM`,
        },
        { status: 400 }
      );
    }

    // Enforce 100MB max file size
    if (fileSizeBytes && Number(fileSizeBytes) > 100 * 1024 * 1024) {
      return Response.json(
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

    return Response.json({
      success: true,
      key: uploadInfo.key,
      uploadUrl: uploadInfo.uploadUrl,
      contentType: uploadInfo.contentType,
      expiresIn: uploadInfo.expiresIn,
      provider: uploadInfo.provider,
    });
  } catch (err: any) {
    console.error("Recording initiate error:", err);
    return Response.json(
      { success: false, error: err.message || "Failed to generate presigned upload URL" },
      { status: 500 }
    );
  }
}
