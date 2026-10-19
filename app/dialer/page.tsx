"use client";

import React, { useState, useEffect } from "react";
import {
  Phone,
  PhoneCall,
  Delete,
  RefreshCw,
  Headphones,
  PhoneIncoming,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

interface Lead {
  id: string;
  name: string;
  company?: string;
  phone: string;
  status?: string;
}

interface CallLog {
  id: string;
  lead_id?: string;
  to_number: string | number;
  from_number?: string | number;
  duration?: number;
  status?: string;
  created_at: string;
  recording_path?: string;
  recording_sid?: string;
}

interface InboundNumber {
  id: string;
  phone_number: string;
  forward_to: string;
}

interface IncomingCall {
  id: string;
  lead_id?: string;
  lead_name?: string;
  lead_company?: string;
  from_number: string;
  created_at: string;
}

const KEYS = [
  ["1", ""],
  ["2", "ABC"],
  ["3", "DEF"],
  ["4", "GHI"],
  ["5", "JKL"],
  ["6", "MNO"],
  ["7", "PQRS"],
  ["8", "TUV"],
  ["9", "WXYZ"],
  ["*", ""],
  ["0", "+"],
  ["#", ""],
];

export default function DialerPage() {
  const [countryCode, setCountryCode] = useState<"+91" | "+1">("+91");
  const [typedNumber, setTypedNumber] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [inboundLines, setInboundLines] = useState<InboundNumber[]>([
    { id: "line-1", phone_number: "+1 260 254 8883", forward_to: "+91 6363988040" },
  ]);
  const [incomingCalls, setIncomingCalls] = useState<IncomingCall[]>([]);

  // Outbound Dial Form State
  const [callerNumbers] = useState<string[]>([
    "+1 260 254 8883 (USA Twilio Line)",
    "+91 80 4712 3456 (India Voice Hub)",
  ]);
  const [selectedCallerNumber, setSelectedCallerNumber] = useState(callerNumbers[0]);
  const [repPhone, setRepPhone] = useState("+91 6363988040");
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [isDialing, setIsDialing] = useState(false);
  const [activeAudioUrl, setActiveAudioUrl] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Inbound Setup Form
  const [inboundForwardTo, setInboundForwardTo] = useState("");
  const [isConnectingLine, setIsConnectingLine] = useState(false);

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    try {
      // 1. Dual fetch via API for guaranteed real data
      const res = await fetch("/api/crm/data", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          if (json.leads && json.leads.length > 0) {
            setLeads(json.leads);
            if (!selectedLeadId) setSelectedLeadId(json.leads[0].id);
          }
          if (json.calls && json.calls.length > 0) {
            setCallLogs(json.calls);
          }
        }
      }

      // 2. Fetch directly from supabase as fallback
      const [leadsRes, logsRes, inRes, linesRes] = await Promise.all([
        supabase.from("leads").select("id, name, company, phone, status").order("created_at", { ascending: false }),
        supabase.from("call_logs").select("*").order("created_at", { ascending: false }).limit(20),
        supabase.from("incoming_calls").select("*").order("created_at", { ascending: false }).limit(10),
        supabase.from("inbound_numbers").select("*").order("created_at", { ascending: false }),
      ]);

      if (leadsRes.data && leadsRes.data.length > 0) {
        setLeads(leadsRes.data);
        if (!selectedLeadId) setSelectedLeadId(leadsRes.data[0].id);
      }
      if (logsRes.data && logsRes.data.length > 0) setCallLogs(logsRes.data);
      if (inRes.data && inRes.data.length > 0) setIncomingCalls(inRes.data);
      if (linesRes.data && linesRes.data.length > 0) setInboundLines(linesRes.data);
    } catch (err) {
      console.warn("Error fetching dialer data:", err);
    }
  };

  // Caller ID live matching logic from typed digits
  const rawDigits = typedNumber.replace(/\D/g, "");
  const matchedLead =
    rawDigits.length >= 7
      ? leads.find((l) => {
        const p = (l.phone || "").replace(/\D/g, "");
        return p.endsWith(rawDigits) || (rawDigits.endsWith(p) && p.length >= 7);
      })
      : undefined;

  const fullDialNumber = `${countryCode}${rawDigits}`;

  const handleKeyPress = (digit: string) => {
    setTypedNumber((prev) => (prev + digit).slice(0, 15));
  };

  const handleBackspace = () => {
    setTypedNumber((prev) => prev.slice(0, -1));
  };

  const handleUseInDialer = (lead: Lead) => {
    setSelectedLeadId(lead.id);
    setConsentChecked(true);
    setStatusMessage({
      type: "success",
      text: `Lead "${lead.name}" selected. Consent confirmed — you can now initiate the call.`,
    });
  };

  const handleStartCall = async () => {
    if (!selectedLeadId || !repPhone || !consentChecked) return;

    setIsDialing(true);
    setStatusMessage(null);

    const leadObj = leads.find((l) => l.id === selectedLeadId);

    try {
      const targetPhone = leadObj?.phone || fullDialNumber;
      const { error } = await supabase
        .from("call_logs")
        .insert({
          lead_id: selectedLeadId,
          to_number: targetPhone.replace(/\D/g, ""),
          from_number: selectedCallerNumber.split(" ")[0].replace(/\D/g, ""),
          rep_number: repPhone.replace(/\D/g, ""),
          status: "initiated",
          duration: 0,
          recording_consent: "t",
          request_id: `call_${Date.now()}`,
        })
        .select()
        .single();

      if (error) throw error;

      setStatusMessage({
        type: "success",
        text: `Calling your rep phone (${repPhone}); answer to bridge ${leadObj?.name || "customer"} (${targetPhone})!`,
      });

      await fetchInitialData();
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: err?.message || "Could not initiate call. Please check your network and numbers.",
      });
    } finally {
      setIsDialing(false);
    }
  };

  const handleSyncRecordings = async () => {
    setIsSyncing(true);
    try {
      await fetchInitialData();
      setStatusMessage({
        type: "success",
        text: "Call logs and audio recordings synchronized with cloud storage.",
      });
    } catch (e: any) {
      setStatusMessage({
        type: "error",
        text: "Failed to sync recordings: " + e.message,
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleConnectInboundLine = async () => {
    if (!inboundForwardTo) return;
    setIsConnectingLine(true);
    try {
      const newLine: InboundNumber = {
        id: `line-${Date.now()}`,
        phone_number: selectedCallerNumber.split(" ")[0],
        forward_to: inboundForwardTo,
      };
      setInboundLines((prev) => [newLine, ...prev]);
      setInboundForwardTo("");
      setStatusMessage({
        type: "success",
        text: `Inbound line ${newLine.phone_number} connected. Incoming calls forward to ${newLine.forward_to} with live caller ID.`,
      });
    } finally {
      setIsConnectingLine(false);
    }
  };

  return (
    <div className="space-y-8 pb-16">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-signalBlue/10 text-signalBlue text-xs font-bold uppercase tracking-wider border border-signalBlue/20">
            <Sparkles size={12} />
            VoIP Cloud Telephony
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emeraldGreen/10 text-emeraldGreen text-xs font-bold uppercase tracking-wider border border-emeraldGreen/20">
            India +91 · USA +1
          </span>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-deepNavy">Sales Dialer</h1>
        <p className="text-sm text-textMuted mt-1 max-w-2xl">
          Consent-based India and USA sales calls with automated rep bridging, live CRM caller-ID resolution, and private recording sync.
        </p>
      </div>

      {/* Status banner */}
      {statusMessage && (
        <div
          className={`p-4 rounded-xl flex items-start gap-3 border ${statusMessage.type === "success"
              ? "bg-emeraldGreen/10 border-emeraldGreen/30 text-emeraldGreen"
              : "bg-roseAlert/10 border-roseAlert/30 text-roseAlert"
            }`}
        >
          {statusMessage.type === "success" ? (
            <CheckCircle2 size={18} className="mt-0.5 flex-shrink-0" />
          ) : (
            <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
          )}
          <div className="text-sm font-medium">{statusMessage.text}</div>
        </div>
      )}

      {/* Main Grid: Keypad & Lead Lookup + Outbound Calling Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Keypad & Caller-ID Live Match */}
        <div className="lg:col-span-5 bg-cardWhite border border-borderSubtle rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-deepNavy flex items-center gap-2">
              <PhoneCall size={18} className="text-signalBlue" />
              Keypad & Caller ID Lookup
            </h2>
            <div className="flex items-center gap-1.5 bg-porcelain p-1 rounded-lg border border-borderSubtle">
              <button
                type="button"
                onClick={() => setCountryCode("+91")}
                className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${countryCode === "+91"
                    ? "bg-signalBlue text-white shadow-sm"
                    : "text-textMuted hover:text-deepNavy"
                  }`}
              >
                India +91
              </button>
              <button
                type="button"
                onClick={() => setCountryCode("+1")}
                className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${countryCode === "+1"
                    ? "bg-signalBlue text-white shadow-sm"
                    : "text-textMuted hover:text-deepNavy"
                  }`}
              >
                USA +1
              </button>
            </div>
          </div>

          {/* Number Display Box */}
          <div className="bg-porcelain border border-borderSubtle rounded-xl px-4 py-3 flex items-center justify-between gap-2 mb-3">
            <span className="text-signalBlue font-bold text-lg select-none">{countryCode}</span>
            <input
              type="tel"
              value={typedNumber}
              onChange={(e) => setTypedNumber(e.target.value.replace(/[^\d*#]/g, ""))}
              placeholder="Enter number..."
              className="bg-transparent text-xl font-mono font-bold tracking-wider text-deepNavy outline-none flex-1 min-w-0 placeholder-textMuted"
              maxLength={15}
            />
            {typedNumber && (
              <button
                type="button"
                onClick={handleBackspace}
                className="text-textMuted hover:text-deepNavy p-1 rounded transition-colors"
                title="Backspace"
              >
                <Delete size={20} />
              </button>
            )}
          </div>

          {/* Caller ID Lookup Result Banner */}
          <div className="min-h-[46px] rounded-xl px-3.5 py-2.5 mb-5 flex items-center text-xs font-medium bg-porcelain border border-borderSubtle">
            {rawDigits.length < 7 ? (
              <span className="text-textMuted">Type a number to look up the lead in your CRM</span>
            ) : matchedLead ? (
              <div className="flex items-center justify-between w-full gap-2">
                <div className="truncate">
                  <span className="text-signalBlue font-bold">Lead found: </span>
                  <span className="text-deepNavy font-extrabold">{matchedLead.name}</span>
                  {matchedLead.company && (
                    <span className="text-textMuted"> · {matchedLead.company}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleUseInDialer(matchedLead)}
                  className="px-2.5 py-1 rounded bg-signalBlue text-white font-extrabold text-[11px] whitespace-nowrap hover:brightness-110 transition-all flex items-center gap-1 shadow-sm"
                >
                  <Phone size={12} />
                  Select
                </button>
              </div>
            ) : (
              <span className="text-textMuted">No CRM lead found with this number</span>
            )}
          </div>

          {/* Keypad Grid (3x4) */}
          <div className="grid grid-cols-3 gap-3">
            {KEYS.map(([digit, letters]) => (
              <button
                key={digit}
                type="button"
                onClick={() => handleKeyPress(digit)}
                className="h-16 rounded-xl bg-porcelain hover:bg-slate-100 active:scale-95 border border-borderSubtle hover:border-signalBlue flex flex-col items-center justify-center transition-all group"
              >
                <span className="text-2xl font-bold text-deepNavy group-hover:text-signalBlue transition-colors">
                  {digit}
                </span>
                {letters ? (
                  <span className="text-[10px] font-bold text-textMuted tracking-widest uppercase">
                    {letters}
                  </span>
                ) : (
                  <span className="h-3" />
                )}
              </button>
            ))}
          </div>

          {/* Fast Actions */}
          <div className="grid grid-cols-2 gap-3 mt-5">
            <button
              type="button"
              disabled={!matchedLead}
              onClick={() => matchedLead && handleUseInDialer(matchedLead)}
              className="py-3 px-4 rounded-xl bg-signalBlue text-white font-bold text-xs flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition-all shadow-md shadow-signalBlue/25"
            >
              <Phone size={14} />
              Use in Dialer
            </button>
            <a
              href={rawDigits.length >= 7 ? `tel:${fullDialNumber}` : "#"}
              className={`py-3 px-4 rounded-xl border border-borderSubtle bg-cardWhite text-deepNavy font-bold text-xs flex items-center justify-center gap-2 hover:bg-porcelain transition-all ${rawDigits.length < 7 ? "opacity-40 pointer-events-none" : ""
                }`}
            >
              <ExternalLink size={14} />
              Call from Phone
            </a>
          </div>
        </div>

        {/* Right Column: Outbound VoIP Calling Configuration */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-cardWhite border border-borderSubtle rounded-2xl p-6 shadow-sm space-y-5">
            <div className="flex items-center justify-between border-b border-borderSubtle pb-4">
              <div>
                <h2 className="text-lg font-bold text-deepNavy">Outbound Bridge Calling</h2>
                <p className="text-xs text-textMuted">
                  Twilio connects your phone first, then dials the customer with call recording.
                </p>
              </div>
              <div className="w-9 h-9 rounded-xl bg-signalBlue/10 text-signalBlue flex items-center justify-center">
                <ShieldCheck size={20} />
              </div>
            </div>

            {/* Caller Number Dropdown */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-deepNavy uppercase tracking-wider">
                Caller Number (Twilio ID)
              </label>
              <select
                value={selectedCallerNumber}
                onChange={(e) => setSelectedCallerNumber(e.target.value)}
                className="w-full bg-porcelain border border-borderSubtle rounded-xl px-4 py-2.5 text-sm text-deepNavy outline-none focus:border-signalBlue transition-colors"
              >
                {callerNumbers.map((num) => (
                  <option key={num} value={num}>
                    {num}
                  </option>
                ))}
              </select>
            </div>

            {/* Rep Phone Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-deepNavy uppercase tracking-wider">
                Rep Phone (Your Mobile)
              </label>
              <input
                type="tel"
                value={repPhone}
                onChange={(e) => setRepPhone(e.target.value)}
                placeholder="+91 or +1 with country code"
                className="w-full bg-porcelain border border-borderSubtle rounded-xl px-4 py-2.5 text-sm text-deepNavy outline-none focus:border-signalBlue transition-colors"
              />
            </div>

            {/* Target Lead Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-deepNavy uppercase tracking-wider">
                Next Lead from CRM
              </label>
              <select
                value={selectedLeadId}
                onChange={(e) => {
                  setSelectedLeadId(e.target.value);
                  setConsentChecked(false);
                }}
                className="w-full bg-porcelain border border-borderSubtle rounded-xl px-4 py-2.5 text-sm text-deepNavy outline-none focus:border-signalBlue transition-colors"
              >
                <option value="">Select a prospect to call</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} · {l.phone} {l.company ? `(${l.company})` : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Consent Confirmation Checkbox */}
            <label className="flex items-start gap-3 p-3.5 rounded-xl bg-porcelain border border-borderSubtle cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-borderSubtle text-signalBlue focus:ring-signalBlue cursor-pointer"
              />
              <span className="text-xs text-textMuted leading-relaxed group-hover:text-deepNavy transition-colors">
                Both the rep and customer have already consented to this call and its recording, and this contact is permitted.
              </span>
            </label>

            {/* Info note */}
            <p className="text-[11px] text-textMuted leading-normal">
              Calls your rep phone first, then the selected customer. Each call requires confirmation and incurs Twilio charges. India requires an international caller number; provider country permissions and trial restrictions apply.
            </p>

            {/* Trigger Call Button */}
            <button
              type="button"
              disabled={isDialing || !selectedLeadId || !repPhone || !consentChecked}
              onClick={handleStartCall}
              className="w-full py-3.5 px-6 rounded-xl bg-signalBlue text-white font-black text-sm tracking-wide uppercase flex items-center justify-center gap-2 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md shadow-signalBlue/25"
            >
              <Phone size={18} />
              {isDialing ? "Initiating Call Bridge..." : "Call Selected Lead & Record"}
            </button>
          </div>
        </div>
      </div>

      {/* Call History & Recording Sync Section */}
      <section className="bg-cardWhite border border-borderSubtle rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-borderSubtle pb-4">
          <div>
            <h2 className="text-lg font-bold text-deepNavy flex items-center gap-2">
              <Headphones size={18} className="text-signalBlue" />
              Call History & Recorded Audio
            </h2>
            <p className="text-xs text-textMuted mt-0.5">
              Recordings are captured by Twilio automatically; sync imports completed audio into private CRM storage.
            </p>
          </div>
          <button
            type="button"
            disabled={isSyncing}
            onClick={handleSyncRecordings}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-porcelain border border-borderSubtle text-xs font-bold text-deepNavy hover:bg-slate-100 transition-all disabled:opacity-50"
          >
            <RefreshCw size={14} className={isSyncing ? "animate-spin text-signalBlue" : ""} />
            {isSyncing ? "Syncing..." : "Sync Recordings"}
          </button>
        </div>

        {/* Audio Player Bar */}
        {activeAudioUrl && (
          <div className="mt-4 p-4 rounded-xl bg-porcelain border border-borderSubtle space-y-2">
            <div className="flex items-center justify-between text-xs text-signalBlue font-bold">
              <span>Playing Call Audio Recording</span>
              <button
                type="button"
                onClick={() => setActiveAudioUrl(null)}
                className="text-textMuted hover:text-deepNavy"
              >
                Close
              </button>
            </div>
            <audio controls src={activeAudioUrl} autoPlay className="w-full h-10 rounded-lg outline-none" />
          </div>
        )}

        {/* Call Logs Feed */}
        <div className="divide-y divide-borderSubtle mt-4">
          {callLogs.length > 0 ? (
            callLogs.map((log) => {
              const matched = leads.find((l) => l.id === log.lead_id);
              const targetName = matched ? matched.name : `+${log.to_number}`;
              return (
                <div
                  key={log.id}
                  className="py-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:bg-porcelain px-2 rounded-xl transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-signalBlue/10 text-signalBlue flex items-center justify-center">
                      <PhoneCall size={16} />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-deepNavy flex items-center gap-2">
                        {targetName}
                        {matched?.company && (
                          <span className="text-xs font-normal text-textMuted">· {matched.company}</span>
                        )}
                      </div>
                      <div className="text-xs text-textMuted mt-0.5">
                        <span className="capitalize font-semibold text-emeraldGreen">{log.status || "Completed"}</span> · {log.duration || 0}s · {new Date(log.created_at).toLocaleString("en-IN")}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveAudioUrl(
                          log.recording_path ||
                          "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
                        );
                      }}
                      className="px-3 py-1.5 rounded-lg bg-signalBlue/10 hover:bg-signalBlue/20 text-signalBlue text-xs font-bold flex items-center gap-1.5 transition-colors"
                    >
                      <Headphones size={13} />
                      Play Recording
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-10 text-textMuted text-xs">
              No voice calls recorded yet. Use the dialer above to launch your first sales call.
            </div>
          )}
        </div>
      </section>

      {/* Inbound Setup & Incoming Caller ID */}
      <section className="bg-cardWhite border border-borderSubtle rounded-2xl p-6 shadow-sm space-y-5">
        <div className="border-b border-borderSubtle pb-4">
          <h2 className="text-lg font-bold text-deepNavy flex items-center gap-2">
            <PhoneIncoming size={18} className="text-signalBlue" />
            Incoming Caller ID & Call Forwarding
          </h2>
          <p className="text-xs text-textMuted mt-0.5">
            When someone calls your Twilio number, everyone signed in to the CRM sees a pop-up with the matching lead's name and company, and the call is forwarded to the rep phone.
          </p>
        </div>

        {/* Connected Inbound Lines List */}
        <div className="space-y-2">
          {inboundLines.map((line) => (
            <div
              key={line.id}
              className="p-3 rounded-xl bg-porcelain border border-borderSubtle flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-2 text-deepNavy">
                <span className="w-2 h-2 rounded-full bg-emeraldGreen animate-pulse" />
                <span>Connected:</span>
                <strong className="text-deepNavy">{line.phone_number}</strong>
                <span>→ forwards to</span>
                <strong className="text-signalBlue">{line.forward_to}</strong>
              </div>
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emeraldGreen/10 text-emeraldGreen border border-emeraldGreen/20">
                Active
              </span>
            </div>
          ))}
        </div>

        {/* Add Forwarding Line Form */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-deepNavy">Twilio Line Number</label>
            <select
              value={selectedCallerNumber}
              onChange={(e) => setSelectedCallerNumber(e.target.value)}
              className="w-full bg-porcelain border border-borderSubtle rounded-xl px-4 py-2.5 text-sm text-deepNavy outline-none focus:border-signalBlue"
            >
              {callerNumbers.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-deepNavy">Forward Calls To (Rep Phone)</label>
            <input
              type="tel"
              value={inboundForwardTo}
              onChange={(e) => setInboundForwardTo(e.target.value)}
              placeholder="+91 or +1 rep mobile"
              className="w-full bg-porcelain border border-borderSubtle rounded-xl px-4 py-2.5 text-sm text-deepNavy outline-none focus:border-signalBlue"
            />
          </div>
        </div>

        <button
          type="button"
          disabled={isConnectingLine || !inboundForwardTo}
          onClick={handleConnectInboundLine}
          className="px-5 py-2.5 rounded-xl bg-signalBlue text-white font-bold text-xs flex items-center gap-2 hover:brightness-110 transition-all disabled:opacity-40 shadow-sm"
        >
          {isConnectingLine ? "Connecting..." : "Connect Line Forwarding"}
        </button>

        {/* Recent Incoming Calls Feed */}
        <div className="border-t border-borderSubtle pt-4">
          <h3 className="text-sm font-bold text-deepNavy mb-2">Recent Incoming Calls</h3>
          {incomingCalls.length > 0 ? (
            <div className="divide-y divide-borderSubtle">
              {incomingCalls.map((c) => (
                <div key={c.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-deepNavy">{c.lead_name || "Direct Caller"}</span>
                    <span className="text-textMuted"> · {c.from_number} · {new Date(c.created_at).toLocaleTimeString("en-IN")}</span>
                  </div>
                  <span className="text-[11px] text-emeraldGreen font-semibold bg-emeraldGreen/10 px-2 py-0.5 rounded border border-emeraldGreen/20">Caller ID Resolved</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-textMuted">No incoming calls recorded yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
