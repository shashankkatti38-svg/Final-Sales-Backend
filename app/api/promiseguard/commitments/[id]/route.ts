import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const { data: commitment, error } = await supabase
      .from("promiseguard_commitments")
      .select(`
        *,
        lead:leads(id, name, company, phone, email, status, value),
        assigned:profiles!promiseguard_commitments_assigned_employee_id_fkey(id, display_name, avatar_url),
        evidence:promiseguard_evidence(*),
        audit_logs:promiseguard_audit_logs(*),
        notifications:promiseguard_notifications(*)
      `)
      .eq("id", id)
      .single();

    if (error || !commitment) {
      return NextResponse.json(
        { success: false, error: error?.message || "Commitment not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, commitment });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();

    // Fetch existing state for audit logging
    const { data: existing } = await supabase
      .from("promiseguard_commitments")
      .select("*")
      .eq("id", id)
      .single();

    if (!existing) {
      return NextResponse.json({ success: false, error: "Commitment not found" }, { status: 404 });
    }

    const updates: Record<string, any> = {};
    const allowedFields = [
      "commitment_text",
      "due_at",
      "status",
      "assigned_employee_id",
      "lead_id",
      "review_status",
      "fulfilled_at",
      "fulfilled_by",
      "evidence_summary",
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    // Check if status is manually set to fulfilled
    if (updates.status === "fulfilled" && !updates.fulfilled_at) {
      updates.fulfilled_at = new Date().toISOString();
    }

    const { data: updated, error } = await supabase
      .from("promiseguard_commitments")
      .update(updates)
      .eq("id", id)
      .select(`
        *,
        lead:leads(id, name, company),
        assigned:profiles!promiseguard_commitments_assigned_employee_id_fkey(id, display_name)
      `)
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Log update audit event
    await supabase.from("promiseguard_audit_logs").insert([
      {
        commitment_id: id,
        action: updates.status === "fulfilled" ? "fulfilled" : "edited",
        old_value: existing,
        new_value: updated,
      },
    ]);

    return NextResponse.json({ success: true, commitment: updated });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
