"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Users,
  TrendingUp,
  PhoneCall,
  CheckSquare,
  Sparkles,
  Phone,
  RefreshCw,
  Clock,
  MapPin,
  ShieldAlert,
  ChevronRight,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { computeSalesRescue, RescueItem } from "@/lib/sales-rescue";

interface Lead {
  id: string;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  value?: number;
  status?: string;
  label?: string;
  address?: string;
  created_at: string;
}

interface Task {
  id: string;
  lead_id?: string;
  title: string;
  priority: string;
  due_at?: string;
  completed?: boolean | string;
}

interface CallLog {
  id: string;
  to_number: string | number;
  duration?: number;
  status?: string;
  created_at: string;
}

export default function DashboardPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      // Dual-fetch: check fast API route for 100% reliable real data
      const res = await fetch("/api/crm/data", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          if (json.leads) setLeads(json.leads);
          if (json.tasks) setTasks(json.tasks);
          if (json.calls) setCalls(json.calls);
          if (json.documents) setDocuments(json.documents);
          if (json.activities) setActivities(json.activities);
          setLoading(false);
          return;
        }
      }

      // Direct Supabase fallback
      const [leadsRes, tasksRes, callsRes, docsRes, actsRes] = await Promise.all([
        supabase.from("leads").select("*").order("created_at", { ascending: false }),
        supabase.from("tasks").select("*").order("created_at", { ascending: false }).limit(20),
        supabase.from("call_logs").select("*").order("created_at", { ascending: false }).limit(10),
        supabase.from("sales_documents").select("*").order("created_at", { ascending: false }).limit(20),
        supabase.from("activities").select("*").order("created_at", { ascending: false }).limit(20),
      ]);

      if (leadsRes.data) setLeads(leadsRes.data);
      if (tasksRes.data) setTasks(tasksRes.data);
      if (callsRes.data) setCalls(callsRes.data);
      if (docsRes.data) setDocuments(docsRes.data);
      if (actsRes.data) setActivities(actsRes.data);
    } catch (e) {
      console.warn("Failed to load dashboard data:", e);
    } finally {
      setLoading(false);
    }
  };

  const rescueQueue: RescueItem[] = computeSalesRescue({
    leads,
    documents,
    tasks,
    activities,
  });

  const totalPipeline = leads.reduce((acc, l) => acc + (Number(l.value) || 0), 0);
  const totalCalls = calls.length;
  const pendingTasks = tasks.filter((t) => !t.completed).length;

  function formatMoney(amount: number) {
    if (amount >= 1e7) return `₹${+(amount / 1e7).toFixed(2)} Cr`;
    if (amount >= 1e5) return `₹${+(amount / 1e5).toFixed(2)} L`;
    if (amount >= 1e3) return `₹${+(amount / 1e3).toFixed(1)} K`;
    return `₹${amount.toLocaleString("en-IN")}`;
  }

  return (
    <div className="space-y-8 pb-16">
      {/* Welcome Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emeraldGreen animate-pulse shadow-sm" />
            <span className="text-xs font-bold text-signalBlue tracking-wider uppercase">Live CRM Pipeline</span>
          </div>
          <h1 className="text-3xl font-extrabold text-deepNavy tracking-tight">Executive Dashboard</h1>
          <p className="text-sm text-textMuted mt-1">Real-time leads, pipeline revenue, follow-ups, and voice telephony.</p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dialer"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-signalBlue text-white font-bold text-xs uppercase tracking-wider hover:brightness-110 shadow-md shadow-signalBlue/25 transition-all"
          >
            <Phone size={14} />
            Open Dialer
          </Link>
          <button
            type="button"
            onClick={loadData}
            className="p-2.5 rounded-xl bg-cardWhite border border-borderSubtle text-deepNavy hover:border-signalBlue hover:text-signalBlue transition-colors shadow-sm"
            title="Refresh Real Data"
          >
            <RefreshCw size={16} className={loading ? "animate-spin text-signalBlue" : ""} />
          </button>
        </div>
      </div>

      {/* KPI Cards Grid (Elevated Attractive White Cards with Ambient Accents) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Total Leads Card */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-[0_4px_20px_-4px_rgba(15,23,42,0.06)] relative overflow-hidden group hover:border-[#7A1F3D]/50 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_16px_36px_-6px_rgba(122,31,61,0.16)] before:absolute before:inset-x-0 before:top-0 before:h-1.5 before:bg-gradient-to-r before:from-[#7A1F3D] before:to-[#C9A96B]">
          <div className="flex items-center justify-between mb-3">
            <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-[#7A1F3D]/10 text-[#7A1F3D] border border-[#7A1F3D]/20">
              PROSPECTS
            </span>
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#7A1F3D]/10 to-[#C9A96B]/15 text-[#7A1F3D] flex items-center justify-center border border-[#7A1F3D]/20 shadow-sm group-hover:scale-110 transition-transform">
              <Users size={20} />
            </div>
          </div>
          <div className="text-3xl font-black text-slate-900 tracking-tight">{loading ? "—" : leads.length}</div>
          <div className="text-xs font-semibold text-slate-500 mt-1 uppercase tracking-wider">Total Active Leads</div>
          <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-100 text-xs font-bold text-emerald-600">
            <TrendingUp size={14} />
            <span>Connected Database</span>
          </div>
        </div>

        {/* Pipeline Value Card */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-[0_4px_20px_-4px_rgba(15,23,42,0.06)] relative overflow-hidden group hover:border-emerald-500/50 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_16px_36px_-6px_rgba(22,163,74,0.16)] before:absolute before:inset-x-0 before:top-0 before:h-1.5 before:bg-gradient-to-r before:from-[#16A34A] before:to-[#10B981]">
          <div className="flex items-center justify-between mb-3">
            <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
              REVENUE
            </span>
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500/10 to-teal-500/15 text-emerald-600 flex items-center justify-center border border-emerald-500/20 shadow-sm group-hover:scale-110 transition-transform">
              <TrendingUp size={20} />
            </div>
          </div>
          <div className="text-3xl font-black text-emerald-600 tracking-tight">{loading ? "—" : formatMoney(totalPipeline)}</div>
          <div className="text-xs font-semibold text-slate-500 mt-1 uppercase tracking-wider">Pipeline Value</div>
          <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-100 text-xs font-bold text-emerald-600">
            <Sparkles size={14} />
            <span>High Intent Opportunities</span>
          </div>
        </div>

        {/* Voice Calls Card */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-[0_4px_20px_-4px_rgba(15,23,42,0.06)] relative overflow-hidden group hover:border-sky-500/50 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_16px_36px_-6px_rgba(2,132,199,0.16)] before:absolute before:inset-x-0 before:top-0 before:h-1.5 before:bg-gradient-to-r before:from-[#0284C7] before:to-[#38BDF8]">
          <div className="flex items-center justify-between mb-3">
            <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-sky-50 text-sky-700 border border-sky-200">
              TELEPHONY
            </span>
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-sky-500/10 to-blue-500/15 text-sky-600 flex items-center justify-center border border-sky-500/20 shadow-sm group-hover:scale-110 transition-transform">
              <PhoneCall size={20} />
            </div>
          </div>
          <div className="text-3xl font-black text-slate-900 tracking-tight">{loading ? "—" : totalCalls}</div>
          <div className="text-xs font-semibold text-slate-500 mt-1 uppercase tracking-wider">Voice Calls Logged</div>
          <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-100 text-xs font-bold text-sky-600">
            <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
            <span>Twilio VoIP & Employee SIM</span>
          </div>
        </div>

        {/* Action Tasks Card */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-[0_4px_20px_-4px_rgba(15,23,42,0.06)] relative overflow-hidden group hover:border-amber-500/50 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_16px_36px_-6px_rgba(217,119,6,0.16)] before:absolute before:inset-x-0 before:top-0 before:h-1.5 before:bg-gradient-to-r before:from-[#D97706] before:to-[#FBBF24]">
          <div className="flex items-center justify-between mb-3">
            <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">
              FOLLOW-UPS
            </span>
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500/10 to-yellow-500/15 text-amber-600 flex items-center justify-center border border-amber-500/20 shadow-sm group-hover:scale-110 transition-transform">
              <CheckSquare size={20} />
            </div>
          </div>
          <div className="text-3xl font-black text-slate-900 tracking-tight">{loading ? "—" : pendingTasks}</div>
          <div className="text-xs font-semibold text-slate-500 mt-1 uppercase tracking-wider">Pending Action Items</div>
          <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-100 text-xs font-bold text-amber-600">
            <Clock size={14} />
            <span>Scheduled For Today</span>
          </div>
        </div>
      </div>

      {/* Sales Rescue & Next-Best Action */}
      {rescueQueue.length > 0 && (
        <section className="bg-cardWhite border border-garnet/40 rounded-2xl p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-garnet/15 text-garnet flex items-center justify-center font-bold">
                <ShieldAlert size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-deepNavy flex items-center gap-2">
                  Sales Rescue & Next-Best Action
                  <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-garnet text-white font-extrabold uppercase tracking-wide">
                    {rescueQueue.length} Attention Required
                  </span>
                </h2>
                <p className="text-xs text-textMuted">Automated detection of stalled quotations, overdue follow-ups, and dormant hot leads</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rescueQueue.slice(0, 6).map((item) => (
              <div
                key={item.id}
                className="p-4 rounded-xl border border-borderSubtle bg-porcelain flex flex-col justify-between gap-3 hover:border-goldAccent transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span
                      className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded ${
                        item.severity === "critical"
                          ? "bg-garnet/20 text-[#E67090]"
                          : "bg-goldAccent/20 text-goldAccent"
                      }`}
                    >
                      {item.severity}
                    </span>
                    <span className="text-[11px] text-textMuted font-medium">{item.reason}</span>
                  </div>
                  <div className="text-sm font-bold text-deepNavy truncate">{item.title}</div>
                  <div className="text-xs text-textMuted mt-1">Lead: {item.leadName}</div>
                </div>

                <Link
                  href={item.actionLink}
                  className="w-full inline-flex items-center justify-between px-3.5 py-2 rounded-lg bg-cardWhite border border-borderSubtle hover:border-goldAccent text-deepNavy text-xs font-bold transition-all"
                >
                  <span>{item.suggestedAction}</span>
                  <ChevronRight size={14} className="text-goldAccent" />
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Main Grid: Prospects List & Tasks Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Prospects List */}
        <div className="lg:col-span-8 bg-cardWhite border border-borderSubtle rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-borderSubtle pb-4 mb-4">
            <div>
              <h2 className="text-lg font-bold text-deepNavy">Recent Prospects ({leads.length})</h2>
              <p className="text-xs text-textMuted">Real customer data directly fetched from Supabase database</p>
            </div>
            <Link
              href="/dialer"
              className="text-xs font-bold text-signalBlue hover:underline flex items-center gap-1 transition-colors"
            >
              Launch Dialer &rarr;
            </Link>
          </div>

          <div className="divide-y divide-borderSubtle">
            {leads.length > 0 ? (
              leads.map((lead) => (
                <div
                  key={lead.id}
                  className="py-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:bg-porcelain px-2 rounded-xl transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-signalBlue/10 text-signalBlue flex items-center justify-center font-bold text-sm">
                      {lead.name?.charAt(0) || "P"}
                    </div>
                    <div>
                      <Link href={`/leads/${lead.id}`} className="text-sm font-bold text-deepNavy hover:text-signalBlue transition-colors">
                        {lead.name}
                      </Link>
                      <div className="text-xs text-textMuted mt-0.5">
                        {lead.company ? `${lead.company} · ` : ""}
                        {lead.phone}
                      </div>
                      {lead.address && (
                        <div className="flex items-center gap-1 text-[11px] text-textMuted mt-0.5">
                          <MapPin size={11} />
                          <span>{lead.address}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-end sm:self-center">
                    {Number(lead.value) > 0 && (
                      <span className="text-xs font-extrabold text-emeraldGreen">
                        ₹{Number(lead.value).toLocaleString("en-IN")}
                      </span>
                    )}
                    <span className="px-2.5 py-1 rounded-md bg-signalBlue/10 text-[11px] font-bold text-signalBlue border border-signalBlue/20">
                      {lead.status || "New"}
                    </span>
                    <Link
                      href="/dialer"
                      className="p-1.5 rounded-lg bg-signalBlue text-white hover:brightness-110 transition-colors shadow-sm"
                      title="Call this lead"
                    >
                      <Phone size={14} />
                    </Link>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-textMuted text-xs">No leads loaded from database yet.</div>
            )}
          </div>
        </div>

        {/* Right Column: Follow-up Tasks & Voice Activity */}
        <div className="lg:col-span-4 space-y-6">
          {/* Priority Tasks */}
          <div className="bg-cardWhite border border-borderSubtle rounded-2xl p-5 shadow-sm">
            <h3 className="text-sm font-bold text-deepNavy flex items-center gap-2 mb-3">
              <CheckSquare size={16} className="text-signalBlue" />
              Follow-up Action Items
            </h3>
            <div className="space-y-2.5">
              {tasks.length > 0 ? (
                tasks.map((task) => (
                  <div key={task.id} className="p-3 rounded-xl bg-porcelain border border-borderSubtle">
                    <div className="text-xs font-bold text-deepNavy">{task.title}</div>
                    <div className="flex items-center justify-between text-[11px] text-textMuted mt-1">
                      <span>Due: Scheduled</span>
                      <span className="px-1.5 py-0.5 rounded bg-amberWarm/10 text-amberWarm font-bold border border-amberWarm/20">
                        {task.priority || "High"}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-xs text-textMuted py-3 text-center">No pending tasks today.</div>
              )}
            </div>
          </div>

          {/* Recent Voice Activity */}
          <div className="bg-cardWhite border border-borderSubtle rounded-2xl p-5 shadow-sm">
            <h3 className="text-sm font-bold text-deepNavy flex items-center gap-2 mb-3">
              <PhoneCall size={16} className="text-emeraldGreen" />
              Recent Voice Activity
            </h3>
            <div className="space-y-2.5">
              {calls.length > 0 ? (
                calls.map((call) => (
                  <div key={call.id} className="p-3 rounded-xl bg-porcelain border border-borderSubtle flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-deepNavy">+{call.to_number}</div>
                      <div className="text-[11px] text-textMuted mt-0.5">
                        {call.duration || 0}s · {new Date(call.created_at).toLocaleDateString("en-IN")}
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-emeraldGreen uppercase bg-emeraldGreen/10 px-2 py-0.5 rounded border border-emeraldGreen/20">Completed</span>
                  </div>
                ))
              ) : (
                <div className="text-xs text-textMuted py-3 text-center">No voice calls recorded yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
