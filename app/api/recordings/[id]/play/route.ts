import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getRecordingPlaybackUrl } from "@/lib/s3";

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

    let playUrl = "";
    if (path.startsWith("http")) {
      playUrl = path;
    } else {
      try {
        playUrl = await getRecordingPlaybackUrl(path, 3600);
      } catch {
        playUrl = supabase.storage.from("call-recordings").getPublicUrl(path).data.publicUrl;
      }
    }

    return NextResponse.json({
      success: true,
      id,
      playUrl,
      duration: callLog.duration || 0,
      toNumber: callLog.to_number,
      status: callLog.status,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
