import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getRecordingDownloadUrl } from "@/lib/s3";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: "Recording ID required" }, { status: 400 });
    }

    const { data: callLog, error } = await supabase
      .from("call_logs")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error || !callLog) {
      return NextResponse.json({ success: false, error: "Recording not found" }, { status: 404 });
    }

    const path = callLog.recording_path;
    if (!path) {
      return NextResponse.json({ success: false, error: "No audio file linked to this call" }, { status: 404 });
    }

    let downloadUrl = "";
    const cleanFileName = `recording_${id}_${callLog.to_number || "audio"}.mp3`;

    if (path.startsWith("http")) {
      downloadUrl = path;
    } else {
      try {
        downloadUrl = await getRecordingDownloadUrl(path, cleanFileName, 3600);
      } catch {
        downloadUrl = supabase.storage.from("call-recordings").getPublicUrl(path).data.publicUrl;
      }
    }

    return NextResponse.json({
      success: true,
      id,
      downloadUrl,
      fileName: cleanFileName,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
