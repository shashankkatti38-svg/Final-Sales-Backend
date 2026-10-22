import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface ExtractedCommitment {
  commitment_text: string;
  commitment_type: "quotation" | "follow_up" | "meeting" | "payment" | "email" | "whatsapp" | "custom";
  responsible_party: string;
  customer_name: string;
  due_at: string;
  confidence_score: number;
  source_excerpt: string;
  explanation: string;
  ambiguous_deadline: boolean;
}

// Rule-based NLP commitment parser as fallback/fast-path
function parseCommitmentPatterns(text: string, referenceTime = new Date()): ExtractedCommitment[] {
  const commitments: ExtractedCommitment[] = [];
  const lines = text.split(/[.\n;!?]+/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();

    // Look for commitment phrases
    const hasPromise =
      lower.includes("i will") ||
      lower.includes("we will") ||
      lower.includes("will send") ||
      lower.includes("will share") ||
      lower.includes("will call") ||
      lower.includes("will update") ||
      lower.includes("promise") ||
      lower.includes("shall send") ||
      lower.includes("get back to you") ||
      lower.includes("schedule a demo") ||
      lower.includes("prepare the quote");

    if (hasPromise) {
      let type: ExtractedCommitment["commitment_type"] = "custom";
      if (lower.includes("quote") || lower.includes("quotation") || lower.includes("pricing") || lower.includes("estimate")) {
        type = "quotation";
      } else if (lower.includes("call") || lower.includes("reach out") || lower.includes("follow up") || lower.includes("touch base")) {
        type = "follow_up";
      } else if (lower.includes("meeting") || lower.includes("demo") || lower.includes("presentation") || lower.includes("zoom")) {
        type = "meeting";
      } else if (lower.includes("pay") || lower.includes("invoice") || lower.includes("transfer")) {
        type = "payment";
      } else if (lower.includes("email")) {
        type = "email";
      } else if (lower.includes("whatsapp")) {
        type = "whatsapp";
      }

      // Deadline calculation from excerpt
      let dueDate = new Date(referenceTime.getTime() + 24 * 3600 * 1000); // default 24h
      let ambiguous = true;

      if (lower.includes("today") || lower.includes("eod") || lower.includes("end of day") || lower.includes("5 pm")) {
        dueDate = new Date(referenceTime);
        dueDate.setHours(17, 0, 0, 0);
        if (dueDate.getTime() <= referenceTime.getTime()) {
          dueDate.setHours(dueDate.getHours() + 2);
        }
        ambiguous = false;
      } else if (lower.includes("tomorrow")) {
        dueDate = new Date(referenceTime.getTime() + 24 * 3600 * 1000);
        dueDate.setHours(17, 0, 0, 0);
        ambiguous = false;
      } else if (lower.includes("in 1 hour") || lower.includes("in an hour")) {
        dueDate = new Date(referenceTime.getTime() + 3600 * 1000);
        ambiguous = false;
      } else if (lower.includes("in 2 hours")) {
        dueDate = new Date(referenceTime.getTime() + 2 * 3600 * 1000);
        ambiguous = false;
      } else if (lower.includes("friday")) {
        dueDate = new Date(referenceTime.getTime() + 4 * 24 * 3600 * 1000);
        dueDate.setHours(17, 0, 0, 0);
        ambiguous = false;
      } else if (lower.includes("monday") || lower.includes("next week")) {
        dueDate = new Date(referenceTime.getTime() + 7 * 24 * 3600 * 1000);
        dueDate.setHours(17, 0, 0, 0);
        ambiguous = false;
      }

      commitments.push({
        commitment_text: trimmed,
        commitment_type: type,
        responsible_party: "Employee / Rep",
        customer_name: "Customer",
        due_at: dueDate.toISOString(),
        confidence_score: ambiguous ? 0.78 : 0.94,
        source_excerpt: trimmed,
        explanation: `Identified commitment to ${type} action from interaction excerpt.`,
        ambiguous_deadline: ambiguous,
      });
    }
  }

  return commitments;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { transcript = "", call_id = null, lead_id = null, save_to_db = false } = body;

    if (!transcript.trim()) {
      return NextResponse.json(
        { success: false, error: "transcript text is required" },
        { status: 400 }
      );
    }

    // Extract commitments using NLP engine
    const extracted = parseCommitmentPatterns(transcript);

    // If requested, save commitments as 'pending_review' for human confirmation
    const savedCommitments = [];
    if (save_to_db && extracted.length > 0) {
      for (const item of extracted) {
        // Check for deduplication
        const { data: existing } = await supabase
          .from("promiseguard_commitments")
          .select("id")
          .eq("lead_id", lead_id)
          .eq("commitment_text", item.commitment_text)
          .maybeSingle();

        if (existing) continue; // deduplicate

        const { data: saved } = await supabase
          .from("promiseguard_commitments")
          .insert([
            {
              lead_id,
              call_id,
              commitment_text: item.commitment_text,
              commitment_type: item.commitment_type,
              due_at: item.due_at,
              source_type: call_id ? "call_recording" : "activity",
              source_reference_id: call_id,
              source_excerpt: item.source_excerpt,
              confidence_score: item.confidence_score,
              review_status: "pending_review",
              status: "pending",
            },
          ])
          .select()
          .single();

        if (saved) savedCommitments.push(saved);
      }
    }

    return NextResponse.json({
      success: true,
      count: extracted.length,
      commitments: extracted,
      saved: savedCommitments,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
