import { twilioGateway, phoneKey } from "@/server-functions/twilio.server";
import { escapeXML } from "@/server-functions/dialer";
import { supabase } from "@/lib/supabase";

const xml = (body: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });
const unavailable = () =>
  xml("<Say>Sorry, this line is not available right now.</Say><Hangup/>");

export async function POST(request: Request) {
  try {
    const form = Object.fromEntries(new URLSearchParams(await request.text()));
    const CallSid = typeof form.CallSid === "string" ? form.CallSid : "";
    const From = typeof form.From === "string" ? form.From : "";
    const To = typeof form.To === "string" ? form.To : "";

    if (!/^CA[0-9a-f]{32}$/.test(CallSid) || !From || From.length > 30 || !To || To.length > 30) {
      return new Response("Bad request", { status: 400 });
    }

    // Verify the call is real and belongs to our connected account (prevents forged webhooks).
    let call: { from: string; to: string; direction: string; status: string };
    try {
      call = await (await twilioGateway(`/Calls/${CallSid}.json`)).json();
    } catch {
      return new Response("Unknown call", { status: 403 });
    }
    if (call.from !== From || call.to !== To || call.direction !== "inbound") {
      return new Response("Call mismatch", { status: 403 });
    }

    const { data: line } = await supabase
      .from("inbound_numbers")
      .select("*")
      .eq("phone_number", To)
      .maybeSingle();

    if (!line) return unavailable();

    const key = phoneKey(From);
    const { data: leads } = await supabase
      .from("leads")
      .select("id,name,company,phone")
      .eq("organization_id", line.organization_id)
      .ilike("phone", `%${key.slice(-4)}%`)
      .limit(200);

    const lead =
      key.length >= 7
        ? leads?.find((l: any) => phoneKey(l.phone) === key)
        : undefined;

    const { error } = await supabase.from("incoming_calls").upsert(
      {
        organization_id: line.organization_id,
        call_sid: CallSid,
        from_number: From,
        to_number: To,
        lead_id: lead?.id ?? null,
        lead_name: lead?.name ?? null,
        lead_company: lead?.company ?? null,
      },
      { onConflict: "call_sid", ignoreDuplicates: true },
    );

    if (error) console.error("incoming call log failed", error);

    return xml(
      `<Dial callerId="${escapeXML(To)}">${escapeXML(line.forward_to)}</Dial>`,
    );
  } catch (err: any) {
    console.error("Twilio voice error:", err);
    return new Response(err?.message || "Internal server error", { status: 500 });
  }
}
