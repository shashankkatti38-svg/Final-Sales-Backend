import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getRecordingPlaybackUrl } from "@/lib/s3";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data: calls, error } = await supabase
      .from("call_logs")
      .select("*")
      .not("recording_path", "is", null)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const recordings = await Promise.all(
      (calls || []).map(async (c: any) => {
        let streamUrl = "";
        const path = c.recording_path || "";

        if (path.startsWith("http")) {
          streamUrl = path;
        } else if (path.startsWith("recordings/org_") || path.startsWith("recordings/")) {
          try {
            streamUrl = await getRecordingPlaybackUrl(path, 3600);
          } catch {
            streamUrl = supabase.storage.from("call-recordings").getPublicUrl(path).data.publicUrl;
          }
        } else {
          streamUrl = supabase.storage.from("call-recordings").getPublicUrl(path).data.publicUrl;
        }

        return {
          id: c.id,
          callId: c.id,
          toNumber: c.to_number ? `+${c.to_number}` : "Unknown",
          fromNumber: c.from_number ? `+${c.from_number}` : "Unknown",
          status: c.status || "completed",
          duration: c.duration || 0,
          recordingPath: c.recording_path,
          streamUrl,
          notes: c.notes || c.summary || null,
          createdAt: c.created_at,
        };
      })
    );

    return NextResponse.json({ success: true, recordings });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
