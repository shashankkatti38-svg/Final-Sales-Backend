import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data: commitments, error } = await supabase
      .from("promiseguard_commitments")
      .select("id, status, due_at, lead_id, fulfilled_at");

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const items = commitments || [];
    const now = Date.now();
    const next24h = now + 24 * 3600 * 1000;

    const total = items.length;
    const fulfilled = items.filter((c) => c.status === "fulfilled").length;
    const needsVerification = items.filter((c) => c.status === "needs_verification").length;
    const overdue = items.filter((c) => {
      if (c.status === "fulfilled" || c.status === "cancelled" || c.status === "rejected") return false;
      return c.status === "overdue" || new Date(c.due_at).getTime() < now;
    }).length;

    const dueSoon = items.filter((c) => {
      if (c.status === "fulfilled" || c.status === "cancelled" || c.status === "rejected") return false;
      const due = new Date(c.due_at).getTime();
      return due >= now && due <= next24h;
    }).length;

    const pending = items.filter((c) => c.status === "pending").length;

    const fulfillmentRate = total > 0 ? Math.round((fulfilled / total) * 100) : 0;

    // At-Risk Deals: unique lead_ids that have overdue or unverified commitments
    const atRiskLeadIds = new Set(
      items
        .filter((c) => (c.status === "overdue" || new Date(c.due_at).getTime() < now) && c.lead_id)
        .map((c) => c.lead_id)
    );
    const atRiskDeals = atRiskLeadIds.size;

    return NextResponse.json({
      success: true,
      analytics: {
        total,
        pending,
        dueSoon,
        overdue,
        fulfilled,
        needsVerification,
        fulfillmentRate,
        atRiskDeals,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
