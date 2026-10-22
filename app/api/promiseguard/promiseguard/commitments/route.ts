import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const leadId = searchParams.get("lead_id");
    const employeeId = searchParams.get("employee_id");
    const search = searchParams.get("search");

    let query = supabase
      .from("promiseguard_commitments")
      .select(`
        *,
        lead:leads(id, name, company, phone, email, status, value),
        assigned:profiles!promiseguard_commitments_assigned_employee_id_fkey(id, display_name, avatar_url)
      `)
      .order("due_at", { ascending: true });

    if (status && status !== "all") {
      query = query.eq("status", status);
    }
    if (leadId) {
      query = query.eq("lead_id", leadId);
    }
    if (employeeId) {
      query = query.eq("assigned_employee_id", employeeId);
    }

    const { data: commitments, error } = await query;

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    let results = commitments || [];

    // Filter by search query if provided
    if (search) {
      const q = search.toLowerCase();
      results = results.filter((c: any) =>
        (c.commitment_text || "").toLowerCase().includes(q) ||
        (c.lead?.name || "").toLowerCase().includes(q) ||
        (c.lead?.company || "").toLowerCase().includes(q) ||
        (c.assigned?.display_name || "").toLowerCase().includes(q)
      );
    }

    return NextResponse.json({ success: true, commitments: results });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      commitment_text,
      due_at,
      lead_id,
      assigned_employee_id,
      commitment_type = "custom",
      source_type = "manual",
      source_reference_id = null,
      source_excerpt = null,
      confidence_score = 1.0,
      review_status = "confirmed",
      organization_id,
    } = body;

    if (!commitment_text || !due_at) {
      return NextResponse.json(
        { success: false, error: "commitment_text and due_at are required" },
        { status: 400 }
      );
    }

    // Determine initial status based on due date
    const dueDate = new Date(due_at);
    const initialStatus = dueDate < new Date() ? "overdue" : "pending";

    const insertPayload: Record<string, any> = {
      commitment_text: commitment_text.trim(),
      due_at,
      lead_id: lead_id || null,
      assigned_employee_id: assigned_employee_id || null,
      commitment_type,
      source_type,
      source_reference_id,
      source_excerpt,
      confidence_score,
      review_status,
      status: initialStatus,
    };

    if (organization_id) {
      insertPayload.organization_id = organization_id;
    }

    const { data: commitment, error } = await supabase
      .from("promiseguard_commitments")
      .insert([insertPayload])
      .select(`
        *,
        lead:leads(id, name, company),
        assigned:profiles!promiseguard_commitments_assigned_employee_id_fkey(id, display_name)
      `)
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Schedule smart reminders in promiseguard_notifications
    const recipientId = assigned_employee_id || commitment.created_by || "system";
    const dueTime = dueDate.getTime();
    const now = Date.now();

    const reminders = [
      { type: "24h_before", time: dueTime - 24 * 3600 * 1000 },
      { type: "2h_before", time: dueTime - 2 * 3600 * 1000 },
      { type: "30m_before", time: dueTime - 30 * 60 * 1000 },
      { type: "at_deadline", time: dueTime },
    ].filter((r) => r.time > now);

    if (reminders.length > 0) {
      const notifications = reminders.map((r) => ({
        commitment_id: commitment.id,
        recipient_id: recipientId,
        notification_type: r.type,
        scheduled_at: new Date(r.time).toISOString(),
        delivery_status: "scheduled",
      }));
      await supabase.from("promiseguard_notifications").insert(notifications);
    }

    // Log to promiseguard_audit_logs
    await supabase.from("promiseguard_audit_logs").insert([
      {
        commitment_id: commitment.id,
        action: "created",
        new_value: commitment,
      },
    ]);

    return NextResponse.json({ success: true, commitment });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
