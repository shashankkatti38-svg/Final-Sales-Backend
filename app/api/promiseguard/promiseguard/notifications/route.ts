import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

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
    const { notification_id, action = "dismiss" } = body;

    if (!notification_id) {
      return NextResponse.json(
        { success: false, error: "notification_id is required" },
        { status: 400 }
      );
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
