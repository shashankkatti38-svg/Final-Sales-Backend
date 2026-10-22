import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { evidence_type = "document", notes = "", source_reference_id = null } = body;

    const { data: evidence, error } = await supabase
      .from("promiseguard_evidence")
      .insert([
        {
          commitment_id: id,
          evidence_type,
          source_reference_id,
          verification_status: "verified",
          notes,
        },
      ])
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Update commitment evidence summary
    await supabase
      .from("promiseguard_commitments")
      .update({
        evidence_summary: notes || `Attached ${evidence_type}`,
        status: "verified",
      })
      .eq("id", id);

    await supabase.from("promiseguard_audit_logs").insert([
      {
        commitment_id: id,
        action: "evidence_added",
        new_value: evidence,
      },
    ]);

    return NextResponse.json({ success: true, evidence });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
