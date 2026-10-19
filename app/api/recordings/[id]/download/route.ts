import { getSupabaseClient } from "@/lib/supabase";
import { getRecordingDownloadUrl } from "@/lib/s3";

export const dynamic = "force-dynamic";

/**
 * GET /api/recordings/:id/download
 * Function: Generate temporary private download URL with attachment header
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
      return Response.json({ success: false, error: "Recording not found" }, { status: 404 });
    }

    const path = callLog.recording_path;
    if (!path) {
      return Response.json({ success: false, error: "No audio file linked to this call" }, { status: 404 });
    }

    let downloadUrl = "";
    const cleanFileName = `recording_${id}_${callLog.to_number || "audio"}.mp3`;

    if (path.startsWith("http")) {
      downloadUrl = path;
    } else {
      try {
        downloadUrl = await getRecordingDownloadUrl(path, cleanFileName, 3600);
      } catch {
        downloadUrl = supabaseClient.storage.from("call-recordings").getPublicUrl(path).data.publicUrl;
      }
    }

    return Response.json({
      success: true,
      id,
      downloadUrl,
      fileName: cleanFileName,
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
