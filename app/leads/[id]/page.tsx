"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ChevronLeft,
  Phone,
  Mail,
  MessageCircle,
  Pencil,
  PlusCircle,
  StickyNote,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { STAGES } from "@/lib/constants";

interface Lead {
  id: string;
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  value?: number;
  status: string;
  label: string;
  source?: string;
  address?: string;
  created_at: string;
}

interface ActivityItem {
  id: string;
  lead_id: string;
  type: string;
  notes?: string;
  occurred_at: string;
}

const TYPES = [
  "Call",
  "Meeting",
  "Follow-up",
  "Site visit",
  "WhatsApp",
  "Email",
  "Demo",
  "Feedback",
  "Note",
] as const;

export default function LeadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [lead, setLead] = useState<Lead | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"Timeline" | "Notes" | "Info">("Timeline");

  // Activity Dialog
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [actType, setActType] = useState<string>("Call");
  const [actNotes, setActNotes] = useState("");
  const [savingAct, setSavingAct] = useState(false);

  // Status & Label Picker
  const [statusModal, setStatusModal] = useState<"status" | "label" | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (id) {
      loadLead();
    }
  }, [id]);

  const loadLead = async () => {
    try {
      setLoading(true);
      // Dual-fetch: check fast API route for 100% reliable real data
      const res = await fetch("/api/crm/data", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.leads) {
          const found = json.leads.find((l: Lead) => l.id === id);
          if (found) {
            setLead(found);
            const foundActs = (json.activities || []).filter((a: ActivityItem) => a.lead_id === id);
            setActivities(foundActs);
            setLoading(false);
            return;
          }
        }
      }

      // Fallback to Supabase client
      const [leadRes, actRes] = await Promise.all([
        supabase.from("leads").select("*").eq("id", id).single(),
        supabase.from("activities").select("*").eq("lead_id", id).order("occurred_at", { ascending: false }),
      ]);

      if (leadRes.data) setLead(leadRes.data as Lead);
      if (actRes.data) setActivities(actRes.data as ActivityItem[]);
    } catch (e) {
      console.warn("Failed to load lead details:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (newStatus: string) => {
    if (!lead) return;
    setUpdating(true);
    try {
      const { error } = await supabase.from("leads").update({ status: newStatus }).eq("id", id);
      if (error) throw error;
      await supabase.from("activities").insert({
        lead_id: id,
        type: "Note",
        notes: `Status changed to ${newStatus}`,
        occurred_at: new Date().toISOString(),
      });
      setStatusModal(null);
      await loadLead();
    } catch (e) {
      console.warn("Error updating status:", e);
    } finally {
      setUpdating(false);
    }
  };

  const handleUpdateLabel = async (newLabel: string) => {
    if (!lead) return;
    setUpdating(true);
    try {
      const { error } = await supabase.from("leads").update({ label: newLabel }).eq("id", id);
      if (error) throw error;
      await supabase.from("activities").insert({
        lead_id: id,
        type: "Note",
        notes: `Label changed to ${newLabel}`,
        occurred_at: new Date().toISOString(),
      });
      setStatusModal(null);
      await loadLead();
    } catch (e) {
      console.warn("Error updating label:", e);
    } finally {
      setUpdating(false);
    }
  };

  const handleAddActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lead) return;
    setSavingAct(true);
    try {
      const { error } = await supabase.from("activities").insert({
        lead_id: id,
        type: actType,
        notes: actNotes,
        occurred_at: new Date().toISOString(),
      });
      if (error) throw error;
      setIsActivityOpen(false);
      setActNotes("");
      await loadLead();
    } catch (e) {
      console.warn("Error creating activity:", e);
    } finally {
      setSavingAct(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center text-textMuted">
        <div className="w-8 h-8 rounded-full border-2 border-signalBlue border-t-transparent animate-spin mx-auto mb-3" />
        Loading real lead details from DB...
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center text-textMuted">
        <p className="mb-4">This lead is unavailable or was removed.</p>
        <Link href="/leads?q=&stage=" className="text-signalBlue font-bold underline">
          &larr; Back to Leads List
        </Link>
      </div>
    );
  }

  const rawPhone = (lead.phone || "").replace(/\D/g, "");

  return (
    <div className="max-w-2xl mx-auto pb-28 pt-2">
      {/* Top Bar */}
      <div className="flex items-center justify-between mb-5">
        <Link
          href="/leads?q=&stage="
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cardWhite border border-borderSubtle text-xs font-bold text-deepNavy hover:border-signalBlue hover:text-signalBlue transition-colors shadow-sm"
        >
          <ChevronLeft size={16} />
          Back to Leads
        </Link>
        <Link
          href="/dialer"
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-signalBlue text-white text-xs font-bold hover:scale-105 transition-transform shadow-md shadow-signalBlue/30"
        >
          <Phone size={14} />
          Sales Dialer
        </Link>
      </div>

      {/* Lead Card Header */}
      <div className="bg-cardWhite border border-borderSubtle rounded-2xl p-6 shadow-sm mb-6">
        <h1 className="text-2xl sm:text-3xl font-black text-deepNavy">{lead.name}</h1>
        {lead.company && <p className="text-sm text-textMuted mt-0.5">{lead.company}</p>}

        {/* Lead Value */}
        <div className="mt-3 text-2xl font-black text-emeraldGreen">
          <span>₹ </span>
          {Number(lead.value || 0).toLocaleString("en-IN")}
        </div>

        {/* Quick Status & Label Pickers */}
        <div className="grid grid-cols-2 gap-4 my-5 pt-4 border-t border-borderSubtle">
          <button
            type="button"
            onClick={() => setStatusModal("status")}
            className="text-left p-3 rounded-xl bg-porcelain border border-borderSubtle hover:border-signalBlue transition-colors group"
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-textMuted flex items-center justify-between">
              Status <Pencil size={12} className="text-signalBlue group-hover:scale-110 transition-transform" />
            </span>
            <span className="block text-sm font-extrabold text-signalBlue mt-1 truncate">{lead.status}</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusModal("label")}
            className="text-left p-3 rounded-xl bg-porcelain border border-borderSubtle hover:border-signalBlue transition-colors group"
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-textMuted flex items-center justify-between">
              Label <Pencil size={12} className="text-signalBlue group-hover:scale-110 transition-transform" />
            </span>
            <span className="block text-sm font-extrabold text-deepNavy mt-1 truncate">{lead.label || "Warm"}</span>
          </button>
        </div>

        {/* Action Buttons Row */}
        <div className="grid grid-cols-4 gap-2.5 pt-2">
          <a
            href={lead.phone ? `tel:${lead.phone}` : "#"}
            className={`p-3 rounded-xl flex flex-col items-center justify-center gap-1.5 text-xs font-bold transition-all ${
              lead.phone
                ? "bg-signalBlue text-white shadow-md shadow-signalBlue/25 hover:brightness-110"
                : "bg-porcelain text-slate-400 cursor-not-allowed"
            }`}
          >
            <Phone size={18} />
            <span>Call</span>
          </a>

          <a
            href={rawPhone ? `https://wa.me/${rawPhone}` : "#"}
            target="_blank"
            rel="noreferrer"
            className={`p-3 rounded-xl flex flex-col items-center justify-center gap-1.5 text-xs font-bold transition-all ${
              rawPhone
                ? "bg-emeraldGreen text-white shadow-md shadow-emeraldGreen/25 hover:brightness-110"
                : "bg-porcelain text-slate-400 cursor-not-allowed"
            }`}
          >
            <MessageCircle size={18} />
            <span>WhatsApp</span>
          </a>

          <a
            href={lead.email ? `mailto:${lead.email}` : "#"}
            className={`p-3 rounded-xl flex flex-col items-center justify-center gap-1.5 text-xs font-bold transition-all ${
              lead.email
                ? "bg-deepNavy text-white shadow-md shadow-deepNavy/25 hover:brightness-110"
                : "bg-porcelain text-slate-400 cursor-not-allowed"
            }`}
          >
            <Mail size={18} />
            <span>Email</span>
          </a>

          <button
            type="button"
            onClick={() => {
              setActType("Call");
              setIsActivityOpen(true);
            }}
            className="p-3 rounded-xl bg-amberWarm text-white font-bold text-xs flex flex-col items-center justify-center gap-1.5 hover:brightness-110 shadow-md shadow-amberWarm/25"
          >
            <PlusCircle size={18} />
            <span>Log Act</span>
          </button>
        </div>
      </div>

      {/* Tabs Section */}
      <div className="bg-cardWhite border border-borderSubtle rounded-2xl p-5 shadow-sm">
        <div className="flex border-b border-borderSubtle gap-4 mb-4">
          <button
            type="button"
            onClick={() => setActiveTab("Timeline")}
            className={`pb-2.5 text-xs font-bold transition-colors ${
              activeTab === "Timeline"
                ? "border-b-2 border-signalBlue text-signalBlue"
                : "text-textMuted hover:text-deepNavy"
            }`}
          >
            Timeline ({activities.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("Notes")}
            className={`pb-2.5 text-xs font-bold transition-colors ${
              activeTab === "Notes"
                ? "border-b-2 border-signalBlue text-signalBlue"
                : "text-textMuted hover:text-deepNavy"
            }`}
          >
            Notes ({activities.filter((a) => a.type === "Note").length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("Info")}
            className={`pb-2.5 text-xs font-bold transition-colors ${
              activeTab === "Info"
                ? "border-b-2 border-signalBlue text-signalBlue"
                : "text-textMuted hover:text-deepNavy"
            }`}
          >
            Lead Info
          </button>
        </div>

        {activeTab === "Info" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <p className="text-textMuted mb-0.5">Contact Name</p>
              <p className="text-deepNavy font-bold">{lead.name}</p>
            </div>
            <div>
              <p className="text-textMuted mb-0.5">Phone Number</p>
              <p className="text-deepNavy font-bold">{lead.phone || "—"}</p>
            </div>
            <div>
              <p className="text-textMuted mb-0.5">Email Address</p>
              <p className="text-deepNavy font-bold">{lead.email || "—"}</p>
            </div>
            <div>
              <p className="text-textMuted mb-0.5">Company</p>
              <p className="text-deepNavy font-bold">{lead.company || "—"}</p>
            </div>
            <div>
              <p className="text-textMuted mb-0.5">Source</p>
              <p className="text-deepNavy font-bold">{lead.source || "Direct"}</p>
            </div>
            <div>
              <p className="text-textMuted mb-0.5">Address</p>
              <p className="text-deepNavy font-bold">{lead.address || "—"}</p>
            </div>
            <div>
              <p className="text-textMuted mb-0.5">Status</p>
              <p className="text-signalBlue font-bold">{lead.status}</p>
            </div>
            <div>
              <p className="text-textMuted mb-0.5">Label</p>
              <p className="text-deepNavy font-bold">{lead.label}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {activities.length > 0 ? (
              activities.map((a) => (
                <div key={a.id} className="p-3.5 rounded-xl bg-porcelain border border-borderSubtle flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-signalBlue/10 text-signalBlue flex items-center justify-center flex-shrink-0 mt-0.5">
                    {a.type === "Call" ? (
                      <Phone size={15} />
                    ) : a.type === "WhatsApp" ? (
                      <MessageCircle size={15} />
                    ) : (
                      <StickyNote size={15} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-deepNavy">{a.type}</span>
                      <span className="text-[11px] text-textMuted">
                        {new Date(a.occurred_at).toLocaleDateString("en-IN")},{" "}
                        {new Date(a.occurred_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    {a.notes && <p className="text-xs text-textMuted mt-1 whitespace-pre-wrap">{a.notes}</p>}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-center py-8 text-xs text-textMuted">No activities recorded yet for this lead.</p>
            )}
          </div>
        )}
      </div>

      {/* Status or Label Selector Modal */}
      {statusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-deepNavy/60 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-cardWhite border border-borderSubtle rounded-2xl p-5 shadow-2xl">
            <h3 className="text-base font-bold text-deepNavy mb-3">
              {statusModal === "status" ? "Change Lead Status" : "Change Lead Label"}
            </h3>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {((statusModal === "status" ? STAGES : ["Hot", "Warm", "Cold"]) as readonly string[]).map((opt: string) => (
                <button
                  key={opt}
                  type="button"
                  disabled={updating}
                  onClick={() =>
                    statusModal === "status" ? handleUpdateStatus(opt) : handleUpdateLabel(opt)
                  }
                  className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                    (statusModal === "status" ? lead.status : lead.label) === opt
                      ? "bg-signalBlue text-white border-signalBlue shadow-sm"
                      : "bg-porcelain border-borderSubtle text-deepNavy hover:border-signalBlue"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setStatusModal(null)}
              className="w-full mt-4 py-2 rounded-xl bg-porcelain text-xs font-bold text-deepNavy hover:bg-slate-100 border border-borderSubtle"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Add Activity Modal */}
      {isActivityOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-deepNavy/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-cardWhite border border-borderSubtle rounded-2xl p-6 shadow-2xl">
            <h3 className="text-lg font-black text-deepNavy mb-3">Log Activity for {lead.name}</h3>
            <form onSubmit={handleAddActivity} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-deepNavy">Activity Type</label>
                <select
                  value={actType}
                  onChange={(e) => setActType(e.target.value)}
                  className="w-full bg-porcelain border border-borderSubtle rounded-xl px-3.5 py-2 text-sm text-deepNavy outline-none focus:border-signalBlue"
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-deepNavy">Notes & Feedback</label>
                <textarea
                  value={actNotes}
                  onChange={(e) => setActNotes(e.target.value)}
                  rows={4}
                  placeholder="Enter meeting notes, call feedback..."
                  className="w-full bg-porcelain border border-borderSubtle rounded-xl px-3.5 py-2 text-sm text-deepNavy outline-none focus:border-signalBlue"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsActivityOpen(false)}
                  className="px-4 py-2 rounded-xl bg-porcelain border border-borderSubtle text-xs font-bold text-deepNavy hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingAct}
                  className="px-5 py-2 rounded-xl bg-signalBlue text-white font-bold text-xs uppercase hover:brightness-110 disabled:opacity-50 shadow-md shadow-signalBlue/25"
                >
                  {savingAct ? "Saving..." : "Save Activity"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
