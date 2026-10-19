import { getSupabaseClient } from "@/lib/supabase";
import { getRecordingPlaybackUrl } from "@/lib/s3";

export const dynamic = "force-dynamic";

/**
 * GET /api/recordings/:id/play
 * Function: Generate temporary private playback URL for authorized recording
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const id = resolvedParams?.id;

    if (!id) {
      return Response.json({ success: false, error: "Recording ID required" }, { status: 400 });
    }

    const supabaseClient = getSupabaseClient(req);

    const { data: callLog, error } = await supabaseClient
      .from("call_logs")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error || !callLog) {
      return Response.json({ success: false, error: "Recording not found or unauthorized" }, { status: 404 });
    }

    const path = callLog.recording_path;
    if (!path) {
      return Response.json({ success: false, error: "No audio recording linked to this call" }, { status: 404 });
    }

    const urlObj = new URL(req.url);
    const requestedExpires = parseInt(urlObj.searchParams.get("expires") || "3600", 10);
    const expiresIn = Math.min(Math.max(60, requestedExpires), 86400); // 1 min to 24h

    let playUrl = "";
    if (path.startsWith("http")) {
      playUrl = path;
    } else {
      try {
        playUrl = await getRecordingPlaybackUrl(path, expiresIn);
      } catch (err: any) {
        console.warn("S3 signed URL fallback to Supabase public URL:", err.message);
        playUrl = supabaseClient.storage.from("call-recordings").getPublicUrl(path).data.publicUrl;
      }
    }

    // If query string has ?redirect=true, directly 307 redirect to the audio stream
    if (urlObj.searchParams.get("redirect") === "true") {
      return Response.redirect(playUrl, 307);
    }

    return Response.json({
      success: true,
      id,
      playUrl,
      expiresIn,
      duration: callLog.duration || 0,
      toNumber: callLog.to_number,
      fromNumber: callLog.from_number,
      status: callLog.status,
    });
  } catch (err: any) {
    console.error("Play recording error:", err);
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
