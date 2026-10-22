import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const { data: updated, error } = await supabase
      .from("promiseguard_commitments")
      .update({
        review_status: "confirmed",
        confidence_score: body.confidence_score || 1.0,
        status: "pending",
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    await supabase.from("promiseguard_audit_logs").insert([
      {
        commitment_id: id,
        action: "confirmed",
        new_value: updated,
      },
    ]);

    return NextResponse.json({ success: true, commitment: updated });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
