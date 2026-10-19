import { getSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const supabaseClient = getSupabaseClient(req);
    const { data: leads, error } = await supabaseClient
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching leads from Supabase:", error);
      return Response.json({ success: false, error: error.message }, { status: 500 });
    }

    return Response.json({ success: true, count: leads?.length || 0, leads: leads || [] });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabaseClient = getSupabaseClient(req);
    const body = await req.json().catch(() => ({}));
    const { data, error } = await supabaseClient
      .from("leads")
      .insert([body])
      .select()
      .single();

    if (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 });
    }
    return Response.json({ success: true, lead: data });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
