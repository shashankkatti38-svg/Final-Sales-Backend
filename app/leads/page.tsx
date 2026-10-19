"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Plus,
  Search,
  Filter,
  PhoneCall,
  Phone,
  Activity,
  ChevronDown,
  Users,
  X,
  Calendar,
  AlertCircle,
  CheckCircle2,
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
  label: "Hot" | "Warm" | "Cold" | string;
  source?: string;
  address?: string;
  created_at: string;
}

interface ActivityItem {
  id: string;
  lead_id: string;
  type: string;
  occurred_at: string;
  description?: string;
}

function shortMoney(v: number) {
  const val = Number(v) || 0;
  if (val >= 1e7) return `₹ ${+(val / 1e7).toFixed(2)} Crore`;
  if (val >= 1e5) return `₹ ${+(val / 1e5).toFixed(2)} Lakh`;
  if (val >= 1e4) return `₹ ${+(val / 1e3).toFixed(1)} Thousand`;
  return `₹ ${val.toLocaleString("en-IN")}`;
}

function ago(d?: string) {
  if (!d) return "Recently";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 864e5);
  return days <= 0 ? "Today" : days === 1 ? "1 Day Ago" : `${days} Days Ago`;
}

function formatTime(d: string) {
  return new Date(d)
    .toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
    .toUpperCase();
}

function formatDay(d: string) {
  return new Date(d).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const labelStyles: Record<string, string> = {
  Hot: "bg-roseAlert/10 text-roseAlert border border-roseAlert/30",
  Warm: "bg-amberWarm/10 text-amberWarm border border-amberWarm/30",
  Cold: "bg-slate-100 text-slate-600 border border-slate-200",
};

function LeadsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialQ = searchParams?.get("q") ?? "";
  const initialStage = searchParams?.get("stage") ?? "";

  const [leads, setLeads] = useState<Lead[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState(initialQ);
  const [stage, setStage] = useState(initialStage);
  const [showSearch, setShowSearch] = useState(!!initialQ);
  const [showFilter, setShowFilter] = useState(!!initialStage);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    fetchLeadsAndActivities();
  }, []);

  const fetchLeadsAndActivities = async () => {
    try {
      setLoading(true);
      // Dual-fetch: check fast API route for 100% reliable real data
      const res = await fetch("/api/crm/data", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.leads && json.leads.length > 0) {
          setLeads(json.leads as Lead[]);
          if (json.activities) setActivities(json.activities as ActivityItem[]);
          setLoading(false);
          return;
        }
      }

      // Direct Supabase fallback
      const [leadsRes, actRes] = await Promise.all([
        supabase.from("leads").select("*").order("created_at", { ascending: false }),
        supabase.from("activities").select("*").order("occurred_at", { ascending: false }).limit(100),
      ]);

      if (leadsRes.data) setLeads(leadsRes.data as Lead[]);
      if (actRes.data) setActivities(actRes.data as ActivityItem[]);
    } catch (err) {
      console.warn("Failed to fetch leads:", err);
    } finally {
      setLoading(false);
    }
  };

  // Sync state to URL params cleanly
  const updateUrl = (newQ: string, newStage: string) => {
    const params = new URLSearchParams();
    if (newQ) params.set("q", newQ);
    if (newStage) params.set("stage", newStage);
    router.replace(`/leads?${params.toString()}`);
  };

  const handleStageSelect = (s: string) => {
    const nextStage = stage === s ? "" : s;
    setStage(nextStage);
    updateUrl(q, nextStage);
  };

  const handleSearchChange = (val: string) => {
    setQ(val);
    updateUrl(val, stage);
  };

  // Filter leads by query and stage
  const filteredLeads = leads.filter((l) => {
    const matchStage = !stage || l.status === stage;
    const matchQuery =
      !q ||
      `${l.name} ${l.company || ""} ${l.phone || ""} ${l.email || ""}`
        .toLowerCase()
        .includes(q.toLowerCase());
    return matchStage && matchQuery;
  });

  // Group leads by date
  const groups: [string, Lead[]][] = [];
  for (const lead of filteredLeads) {
    const dayKey = formatDay(lead.created_at);
    const existing = groups.find((g) => g[0] === dayKey);
    if (existing) {
      existing[1].push(lead);
    } else {
      groups.push([dayKey, [lead]]);
    }
  }

  const getLastActivity = (leadId: string) => {
    return activities.find((a) => a.lead_id === leadId);
  };

  // Create lead handler
  const handleCreateLead = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError("");
    setSaving(true);

    const formData = new FormData(e.currentTarget);
    const name = String(formData.get("name") || "").trim();
    const company = String(formData.get("company") || "").trim();
    const phone = String(formData.get("phone") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const value = parseFloat(String(formData.get("value") || "0")) || 0;
    const leadStatus = String(formData.get("status") || STAGES[0]);
    const label = String(formData.get("label") || "Warm");
    const source = String(formData.get("source") || "Direct");
    const address = String(formData.get("address") || "").trim();

    if (!name) {
      setFormError("Full name is required");
      setSaving(false);
      return;
    }

    try {
      const payload: Record<string, any> = {
        name,
        company,
        phone,
        email,
        value,
        status: leadStatus,
        label,
        source,
        address,
      };

      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const { error } = await supabase.from("leads").insert(payload).select().single();
        if (error) throw error;
      }

      setIsAddOpen(false);
      setSuccessMessage(`Lead "${name}" successfully saved to CRM!`);
      setTimeout(() => setSuccessMessage(""), 5000);
      await fetchLeadsAndActivities();
    } catch (err: any) {
      setFormError(err.message || "Failed to save lead.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto pb-28 pt-2">
      {/* Top Header matching 3Sigma CRM Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <button
          type="button"
          onClick={() => setShowFilter((v) => !v)}
          className="flex items-center gap-2 text-2xl sm:text-3xl font-black text-deepNavy hover:text-signalBlue transition-colors group"
        >
          <span>Leads ({filteredLeads.length})</span>
          <span className="grid place-items-center w-7 h-7 rounded-full bg-signalBlue text-white group-hover:scale-105 transition-transform">
            <ChevronDown size={18} className={showFilter ? "rotate-180 transition-transform" : "transition-transform"} />
          </span>
        </button>

        {/* Action Circles */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            aria-label="Search leads"
            onClick={() => setShowSearch((v) => !v)}
            className={`grid place-items-center w-11 h-11 rounded-full border transition-all ${
              showSearch
                ? "bg-signalBlue border-signalBlue text-white shadow-md shadow-signalBlue/30"
                : "border-borderSubtle bg-cardWhite text-deepNavy hover:border-signalBlue hover:text-signalBlue"
            }`}
          >
            <Search size={18} />
          </button>
          <button
            type="button"
            aria-label="Filter by stage"
            onClick={() => setShowFilter((v) => !v)}
            className={`grid place-items-center w-11 h-11 rounded-full border transition-all ${
              showFilter
                ? "bg-signalBlue border-signalBlue text-white shadow-md shadow-signalBlue/30"
                : "border-borderSubtle bg-cardWhite text-deepNavy hover:border-signalBlue hover:text-signalBlue"
            }`}
          >
            <Filter size={18} />
          </button>
          <Link
            href="/dialer"
            aria-label="Open dialer"
            className="grid place-items-center w-11 h-11 rounded-full border border-signalBlue bg-signalBlue text-white hover:scale-105 transition-all shadow-md shadow-signalBlue/30"
            title="Launch VoIP Sales Dialer"
          >
            <PhoneCall size={18} />
          </Link>
        </div>
      </div>

      {/* Success banner */}
      {successMessage && (
        <div className="my-3 p-3.5 rounded-xl bg-emeraldGreen/10 border border-emeraldGreen/30 text-emeraldGreen text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 size={16} />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Expandable Search Input */}
      {showSearch && (
        <div className="flex items-center gap-2.5 border border-borderSubtle rounded-full bg-cardWhite px-4 h-12 mt-3 shadow-sm">
          <Search size={16} className="text-signalBlue flex-shrink-0" />
          <input
            autoFocus
            aria-label="Search your leads"
            className="outline-none bg-transparent text-sm w-full text-deepNavy placeholder-textMuted font-medium"
            placeholder="Search name, company, phone, email..."
            value={q}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
          {q && (
            <button
              type="button"
              aria-label="Clear"
              onClick={() => handleSearchChange("")}
              className="text-textMuted hover:text-deepNavy p-1"
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}

      {/* Expandable Filter Chips Carousel */}
      {showFilter && (
        <div className="flex gap-2 overflow-x-auto mt-3 pb-2 scrollbar-none">
          <button
            type="button"
            onClick={() => handleStageSelect("")}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold border transition-all ${
              stage === ""
                ? "bg-signalBlue text-white border-signalBlue shadow-sm"
                : "bg-cardWhite border-borderSubtle text-deepNavy hover:border-signalBlue"
            }`}
          >
            All Stages
          </button>
          {STAGES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleStageSelect(s)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold border transition-all ${
                stage === s
                  ? "bg-signalBlue text-white border-signalBlue shadow-sm"
                  : "bg-cardWhite border-borderSubtle text-deepNavy hover:border-signalBlue"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Leads Feed */}
      {loading ? (
        <div className="text-center py-16 text-textMuted text-sm font-medium">
          <div className="w-8 h-8 rounded-full border-2 border-signalBlue border-t-transparent animate-spin mx-auto mb-3" />
          Fetching live real leads from DB...
        </div>
      ) : filteredLeads.length > 0 ? (
        <div className="mt-4 space-y-6">
          {groups.map(([dayDate, dayLeads]) => (
            <section key={dayDate}>
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-textMuted mb-2.5 px-1 flex items-center gap-1.5">
                <Calendar size={13} className="text-signalBlue" />
                {dayDate}
              </h2>
              <div className="space-y-3">
                {dayLeads.map((l) => {
                  const act = getLastActivity(l.id);
                  return (
                    <div
                      key={l.id}
                      className="relative rounded-2xl bg-cardWhite border border-borderSubtle hover:border-signalBlue shadow-sm p-4 pr-16 transition-all group hover:shadow-md"
                    >
                      <Link href={`/leads/${l.id}`} className="block">
                        <h3 className="text-lg font-black text-deepNavy group-hover:text-signalBlue transition-colors truncate">
                          {l.name}
                        </h3>

                        {/* Badges Row */}
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          {/* Status Pill */}
                          <span className="rounded-md px-2 py-0.5 text-xs font-extrabold bg-signalBlue/10 text-signalBlue border border-signalBlue/20">
                            {l.status}
                          </span>

                          {/* Value Pill */}
                          {Number(l.value) > 0 && (
                            <span className="rounded-md px-2 py-0.5 text-xs font-black bg-emeraldGreen/10 text-emeraldGreen border border-emeraldGreen/20">
                              {shortMoney(Number(l.value))}
                            </span>
                          )}

                          {/* Label Pill */}
                          {l.label && (
                            <span
                              className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                                labelStyles[l.label] || "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {l.label}
                            </span>
                          )}
                        </div>

                        {/* Activity Status Pill */}
                        <div className="mt-2.5">
                          <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold bg-porcelain border border-borderSubtle text-deepNavy">
                            <Activity size={12} className="text-signalBlue" />
                            {act
                              ? `${act.type} ${ago(act.occurred_at)}`
                              : `Updated ${ago(l.created_at)}`}
                          </span>
                        </div>

                        {/* Meta text */}
                        <p className="text-xs text-textMuted mt-2 truncate">
                          {l.company ? `${l.company} · ` : ""}
                          {l.source || "Direct"} · You at {formatTime(l.created_at)}
                        </p>
                      </Link>

                      {/* Direct Phone Call Button */}
                      {l.phone && (
                        <a
                          href={`tel:${l.phone}`}
                          aria-label={`Call ${l.name}`}
                          className="absolute right-4 top-1/2 -translate-y-1/2 grid place-items-center w-11 h-11 rounded-full bg-signalBlue/10 text-signalBlue hover:bg-signalBlue hover:text-white hover:scale-105 transition-all shadow-sm border border-signalBlue/20"
                          title={`Direct call to ${l.phone}`}
                        >
                          <Phone size={18} />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          {/* Footer Signature */}
          <div className="text-center pt-8 pb-4">
            <p className="text-2xl font-black text-slate-300 tracking-tight">That&apos;s all for now</p>
            <p className="text-xs font-semibold text-textMuted mt-1">
              Lead Connect Pro CRM · Real DB Synced
            </p>
          </div>
        </div>
      ) : (
        <div className="text-center py-16 px-4 bg-cardWhite rounded-2xl border border-borderSubtle mt-4">
          <div className="w-12 h-12 rounded-2xl bg-signalBlue/10 text-signalBlue grid place-items-center mx-auto mb-3">
            <Users size={24} />
          </div>
          <h3 className="text-base font-bold text-deepNavy mb-1">
            {q || stage ? "No leads match your filter" : "No leads in pipeline yet"}
          </h3>
          <p className="text-xs text-textMuted max-w-sm mx-auto mb-4">
            {q || stage
              ? "Try adjusting your search keywords or resetting the stage filters."
              : "Click the plus button below to create your very first lead."}
          </p>
          {(q || stage) && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                setStage("");
                updateUrl("", "");
              }}
              className="px-4 py-2 rounded-xl bg-signalBlue text-white text-xs font-bold hover:brightness-110 shadow-sm"
            >
              Reset Filters
            </button>
          )}
        </div>
      )}

      {/* Floating Action Button (+ Add Lead) */}
      <button
        type="button"
        aria-label="Add lead"
        onClick={() => setIsAddOpen(true)}
        className="fixed right-6 bottom-8 z-40 grid place-items-center w-14 h-14 rounded-full bg-signalBlue text-white shadow-xl shadow-signalBlue/40 hover:scale-110 active:scale-95 transition-all"
        title="Add New Lead"
      >
        <Plus size={30} />
      </button>

      {/* Add Lead Modal (LeadForm) */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-deepNavy/60 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-cardWhite border border-borderSubtle rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-borderSubtle pb-4 mb-4">
              <div>
                <h3 className="text-xl font-black text-deepNavy">Add a New Lead</h3>
                <p className="text-xs text-textMuted">Contact details and sales pipeline information</p>
              </div>
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="w-8 h-8 rounded-full bg-porcelain border border-borderSubtle grid place-items-center text-textMuted hover:text-deepNavy"
              >
                <X size={18} />
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-xl bg-roseAlert/10 border border-roseAlert/30 text-roseAlert text-xs flex items-center gap-2">
                <AlertCircle size={15} />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateLead} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-deepNavy">Full Name *</label>
                  <input
                    name="name"
                    required
                    maxLength={100}
                    placeholder="Contact name"
                    className="w-full bg-porcelain border border-borderSubtle rounded-xl px-3.5 py-2 text-sm text-deepNavy outline-none focus:border-signalBlue transition-colors"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-deepNavy">Company</label>
                  <input
                    name="company"
                    maxLength={100}
                    placeholder="Company name"
                    className="w-full bg-porcelain border border-borderSubtle rounded-xl px-3.5 py-2 text-sm text-deepNavy outline-none focus:border-signalBlue transition-colors"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-deepNavy">Phone</label>
                  <input
                    name="phone"
                    maxLength={30}
                    placeholder="+91 or +1"
                    className="w-full bg-porcelain border border-borderSubtle rounded-xl px-3.5 py-2 text-sm text-deepNavy outline-none focus:border-signalBlue transition-colors"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-deepNavy">Email</label>
                  <input
                    name="email"
                    type="email"
                    maxLength={255}
                    placeholder="name@company.com"
                    className="w-full bg-porcelain border border-borderSubtle rounded-xl px-3.5 py-2 text-sm text-deepNavy outline-none focus:border-signalBlue transition-colors"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-deepNavy">Lead Value (₹)</label>
                  <input
                    name="value"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={0}
                    className="w-full bg-porcelain border border-borderSubtle rounded-xl px-3.5 py-2 text-sm text-deepNavy outline-none focus:border-signalBlue transition-colors"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-deepNavy">Source</label>
                  <input
                    name="source"
                    maxLength={100}
                    defaultValue="Direct"
                    className="w-full bg-porcelain border border-borderSubtle rounded-xl px-3.5 py-2 text-sm text-deepNavy outline-none focus:border-signalBlue transition-colors"
                  />
                </div>

                <div className="sm:col-span-2 space-y-1">
                  <label className="text-xs font-bold text-deepNavy">Address</label>
                  <input
                    name="address"
                    maxLength={300}
                    placeholder="Street, city, state"
                    className="w-full bg-porcelain border border-borderSubtle rounded-xl px-3.5 py-2 text-sm text-deepNavy outline-none focus:border-signalBlue transition-colors"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-deepNavy">Stage</label>
                  <select
                    name="status"
                    defaultValue={STAGES[0]}
                    className="w-full bg-porcelain border border-borderSubtle rounded-xl px-3.5 py-2 text-sm text-deepNavy outline-none focus:border-signalBlue"
                  >
                    {STAGES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-deepNavy">Label</label>
                  <select
                    name="label"
                    defaultValue="Warm"
                    className="w-full bg-porcelain border border-borderSubtle rounded-xl px-3.5 py-2 text-sm text-deepNavy outline-none focus:border-signalBlue"
                  >
                    <option value="Hot">Hot</option>
                    <option value="Warm">Warm</option>
                    <option value="Cold">Cold</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-borderSubtle">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="px-4 py-2 rounded-xl bg-porcelain border border-borderSubtle text-xs font-bold text-deepNavy hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-signalBlue text-white font-bold text-xs uppercase tracking-wider hover:brightness-110 disabled:opacity-50 transition-all shadow-md shadow-signalBlue/30"
                >
                  {saving ? "Saving..." : "Save Lead"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LeadsPage() {
  return (
    <Suspense fallback={<div className="text-center py-20 text-textMuted">Loading Leads...</div>}>
      <LeadsContent />
    </Suspense>
  );
}
