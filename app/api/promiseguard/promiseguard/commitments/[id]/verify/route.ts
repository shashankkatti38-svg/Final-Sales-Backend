import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const manualConfirmation = body.manual === true;
    const notes = body.notes || "";

    const { data: commitment, error } = await supabase
      .from("promiseguard_commitments")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !commitment) {
      return NextResponse.json({ success: false, error: "Commitment not found" }, { status: 404 });
    }

    let isFulfilled = false;
    let verificationStatus: "verified" | "needs_verification" = "needs_verification";
    let evidenceType = "manual_confirmation";
    let evidenceReferenceId = "";
    let evidenceSummary = "";

    if (manualConfirmation) {
      isFulfilled = true;
      verificationStatus = "verified";
      evidenceType = "manual_confirmation";
      evidenceSummary = notes || "Manually confirmed and verified by employee";
    } else {
      const type = (commitment.commitment_type || "").toLowerCase();
      const leadId = commitment.lead_id;

      // 1. Quotation Verification
      if (type.includes("quotation") || type.includes("quote") || type.includes("pricing")) {
        const { data: quoteDoc } = await supabase
          .from("sales_documents")
          .select("*")
          .eq("lead_id", leadId)
          .eq("kind", "quotation")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (quoteDoc && (quoteDoc.status === "sent" || quoteDoc.share_token || quoteDoc.approval)) {
          isFulfilled = true;
          verificationStatus = "verified";
          evidenceType = "quotation_sent";
          evidenceReferenceId = quoteDoc.id;
          evidenceSummary = `Verified against Quotation #${quoteDoc.number || quoteDoc.id} sent to customer`;
        } else {
          verificationStatus = "needs_verification";
          evidenceSummary = "Quotation draft created but requires proof of dispatch to customer";
        }
      }
      // 2. Payment Verification
      else if (type.includes("payment") || type.includes("invoice") || type.includes("receipt")) {
        const { data: payment } = await supabase
          .from("payments")
          .select("*")
          .order("paid_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (payment && payment.paid_at) {
          isFulfilled = true;
          verificationStatus = "verified";
          evidenceType = "payment_received";
          evidenceReferenceId = String(payment.id);
          evidenceSummary = `Verified against Payment Receipt of ₹${payment.amount}`;
        } else {
          verificationStatus = "needs_verification";
          evidenceSummary = "No reconciled payment transaction found matching this commitment";
        }
      }
      // 3. Follow-up / Call / Activity Verification
      else if (type.includes("follow") || type.includes("call") || type.includes("meeting")) {
        const { data: act } = await supabase
          .from("activities")
          .select("*")
          .eq("lead_id", leadId)
          .order("occurred_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (act && (act.notes || "").length > 5) {
          isFulfilled = true;
          verificationStatus = "verified";
          evidenceType = "activity_completed";
          evidenceReferenceId = act.id;
          evidenceSummary = `Verified against logged ${act.type}: "${act.notes.slice(0, 80)}"`;
        } else {
          verificationStatus = "needs_verification";
          evidenceSummary = "Follow-up activity pending completion record";
        }
      }
      // 4. Default verification fallback
      else {
        verificationStatus = "needs_verification";
        evidenceSummary = "Requires employee confirmation or documentation link";
      }
    }

    // Update commitment record
    const updatedStatus = isFulfilled ? "fulfilled" : "needs_verification";
    const { data: updated, error: updateErr } = await supabase
      .from("promiseguard_commitments")
      .update({
        status: updatedStatus,
        fulfilled_at: isFulfilled ? new Date().toISOString() : null,
        evidence_summary: evidenceSummary,
      })
      .eq("id", id)
      .select()
      .single();

    if (updateErr) {
      return NextResponse.json({ success: false, error: updateErr.message }, { status: 500 });
    }

    // Insert into promiseguard_evidence
    if (evidenceSummary) {
      await supabase.from("promiseguard_evidence").insert([
        {
          commitment_id: id,
          evidence_type: evidenceType,
          source_reference_id: evidenceReferenceId || null,
          verification_status: verificationStatus,
          notes: evidenceSummary,
        },
      ]);
    }

    // Log audit trail
    await supabase.from("promiseguard_audit_logs").insert([
      {
        commitment_id: id,
        action: isFulfilled ? "verified_fulfilled" : "verification_checked",
        new_value: {
          status: updatedStatus,
          evidenceType,
          evidenceSummary,
        },
      },
    ]);

    return NextResponse.json({
      success: true,
      verified: isFulfilled,
      status: updatedStatus,
      evidenceSummary,
      commitment: updated,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
