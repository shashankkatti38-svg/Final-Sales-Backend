import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [leadsRes, actRes, tasksRes, callsRes] = await Promise.all([
      supabase.from("leads").select("*").order("created_at", { ascending: false }),
      supabase.from("activities").select("*").order("occurred_at", { ascending: false }).limit(100),
      supabase.from("tasks").select("*").order("due_at", { ascending: true }),
      supabase.from("call_logs").select("*").order("created_at", { ascending: false }).limit(20),
    ]);

    return NextResponse.json({
      success: true,
      leads: leadsRes.data || [],
      activities: actRes.data || [],
      tasks: tasksRes.data || [],
      calls: callsRes.data || [],
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
