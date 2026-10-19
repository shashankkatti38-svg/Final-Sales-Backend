import { getSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const supabaseClient = getSupabaseClient(req);
    const [leadsRes, actRes, tasksRes, callsRes] = await Promise.all([
      supabaseClient.from("leads").select("*").order("created_at", { ascending: false }),
      supabaseClient.from("activities").select("*").order("occurred_at", { ascending: false }).limit(100),
      supabaseClient.from("tasks").select("*").order("due_at", { ascending: true }),
      supabaseClient.from("call_logs").select("*").order("created_at", { ascending: false }).limit(20),
    ]);

    return Response.json({
      success: true,
      leads: leadsRes.data || [],
      activities: actRes.data || [],
      tasks: tasksRes.data || [],
      calls: callsRes.data || [],
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
