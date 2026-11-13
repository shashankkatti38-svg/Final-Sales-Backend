import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resend, EMAIL_FROM } from "@/lib/resend";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get("limit")) || 20;

    const { data: notifications, error } = await supabase
      .from("promiseguard_notifications")
      .select(`
        *,
        commitment:promiseguard_commitments(id, commitment_text, due_at, status, lead:leads(name, company))
      `)
      .order("scheduled_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, notifications: notifications || [] });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { notification_id, action = "dismiss", recipient_email } = body;

    if (!notification_id) {
      return NextResponse.json(
        { success: false, error: "notification_id is required" },
        { status: 400 }
      );
    }

    // Fetch the notification with commitment + lead details for the email body.
    const { data: notification, error: fetchError } = await supabase
      .from("promiseguard_notifications")
      .select(`
        *,
        commitment:promiseguard_commitments(
          id, commitment_text, due_at, status,
          lead:leads(name, company)
        )
      `)
      .eq("id", notification_id)
      .single();

    if (fetchError || !notification) {
      return NextResponse.json({ success: false, error: "Notification not found." }, { status: 404 });
    }

    // Send an email reminder via Resend when action is "deliver" and a recipient is provided.
    if (action === "deliver" && recipient_email) {
      const resendApiKey = process.env['RESEND_API_KEY'];
      if (resendApiKey) {
        const commitment = notification.commitment;
        const lead = commitment?.lead;
        const dueAt = commitment?.due_at
          ? new Date(commitment.due_at).toLocaleDateString("en-IN", { dateStyle: "long" })
          : "soon";

        const { error: emailError } = await resend.emails.send({
          from: EMAIL_FROM,
          to: recipient_email,
          subject: `PromiseGuard Reminder: "${commitment?.commitment_text?.slice(0, 80) ?? 'Commitment'}"`,
          html: `
            <p>Hi,</p>
            <p>This is a reminder from <strong>PromiseGuard</strong> about a commitment for lead
              <strong>${lead?.name ?? "Unknown"}</strong>
              ${lead?.company ? `at <strong>${lead.company}</strong>` : ""}.
            </p>
            <blockquote>${commitment?.commitment_text ?? ""}</blockquote>
            <p><strong>Due:</strong> ${dueAt}</p>
            <p>Please follow up and mark it as resolved in your CRM.</p>
          `,
        });

        if (emailError) {
          console.error("[resend] notification email failed:", emailError);
        }
      }
    }

    const { data: updated, error } = await supabase
      .from("promiseguard_notifications")
      .update({
        delivery_status: action === "dismiss" ? "dismissed" : "delivered",
        delivered_at: new Date().toISOString(),
      })
      .eq("id", notification_id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, notification: updated });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
