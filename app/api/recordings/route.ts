import { getSupabaseClient } from "@/lib/supabase";
import { getRecordingPlaybackUrl } from "@/lib/s3";

export const dynamic = "force-dynamic";

/**
 * GET /api/recordings
 * Function: List authorized recordings from database with temporary stream URLs
 */
export async function GET(req: Request) {
  try {
    const supabaseClient = getSupabaseClient(req);

    const { data: calls, error } = await supabaseClient
      .from("call_logs")
      .select("*")
      .not("recording_path", "is", null)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Fetch recordings error:", error);
      return Response.json({ success: false, error: error.message }, { status: 500 });
    }

    const recordings = await Promise.all(
      (calls || []).map(async (c: any) => {
        let streamUrl = "";
        const path = c.recording_path || "";

        if (path.startsWith("http")) {
          streamUrl = path;
        } else if (path.startsWith("recordings/")) {
          try {
            streamUrl = await getRecordingPlaybackUrl(path, 3600);
          } catch {
            streamUrl = supabaseClient.storage.from("call-recordings").getPublicUrl(path).data.publicUrl;
          }
        } else if (path) {
          streamUrl = supabaseClient.storage.from("call-recordings").getPublicUrl(path).data.publicUrl;
        }

        return {
          id: c.id,
          callId: c.id,
          toNumber: c.to_number ? `+${String(c.to_number).replace(/^\+/, "")}` : "Unknown",
          fromNumber: c.from_number ? `+${String(c.from_number).replace(/^\+/, "")}` : "Unknown",
          status: c.status || "completed",
          duration: c.duration || 0,
          recordingPath: c.recording_path,
          streamUrl,
          notes: c.notes || c.summary || null,
          createdAt: c.created_at,
        };
      })
    );

    return Response.json({
      success: true,
      count: recordings.length,
      recordings,
    });
  } catch (err: any) {
    console.error("List recordings error:", err);
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
