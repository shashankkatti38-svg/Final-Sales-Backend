import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import { PhoneCall, LayoutDashboard, Sparkles, Users } from "lucide-react";

export const metadata: Metadata = {
  title: "Lead Catalyst CRM — Enterprise Sales & Telephony",
  description: "Enterprise Sales CRM and Live Dialer with caller-ID lookup, SIM telephony, Twilio VoIP, and Supabase synchronization.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#F8FAFC] text-[#0F172A] min-h-screen flex flex-col antialiased">
        {/* Clean Light Top Navigation Header */}
        <header className="sticky top-0 z-50 bg-[#FFFFFF] text-[#0F172A] px-6 py-3.5 shadow-sm border-b border-[#E2E8F0]">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-6">
              <Link href="/leads?q=&stage=" className="flex items-center gap-3 group">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7A1F3D] to-[#5F172F] border border-[#C9A96B]/40 flex items-center justify-center shadow-md shadow-[#7A1F3D]/25 text-white font-black text-base tracking-wider group-hover:scale-105 transition-transform">
                  LC
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-black text-lg tracking-tight text-[#0B1B46]">
                      LeadConnect
                    </span>
                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-[#7A1F3D] text-white tracking-wide shadow-sm">
                      PRO
                    </span>
                  </div>
                  <p className="text-[11px] text-[#64748B] font-medium">Enterprise Dialer & Lead Flow</p>
                </div>
              </Link>

              {/* Navigation links */}
              <nav className="hidden md:flex items-center gap-2 pl-4 border-l border-[#E2E8F0]">
                <Link
                  href="/leads?q=&stage="
                  className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-semibold text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"
                >
                  <Users size={16} className="text-[#C9A96B]" />
                  Leads (3Sigma)
                </Link>
                <Link
                  href="/dashboard"
                  className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-semibold text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"
                >
                  <LayoutDashboard size={16} className="text-[#7A1F3D]" />
                  Dashboard
                </Link>
                <Link
                  href="/dialer"
                  className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-semibold text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"
                >
                  <PhoneCall size={16} className="text-[#4F7C6D]" />
                  Sales Dialer
                </Link>
              </nav>
            </div>

            {/* Live Indicators */}
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#7A1F3D]/10 border border-[#7A1F3D]/20 text-[12px] font-semibold text-[#7A1F3D]">
                <div className="w-2 h-2 rounded-full bg-[#16A34A] animate-pulse" />
                Live DB Connected
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F1F5F9] border border-[#E2E8F0] text-[12px] font-semibold text-[#64748B]">
                <Sparkles size={14} className="text-[#C9A96B]" />
                <span>India +91 & USA +1</span>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>

        {/* Footer */}
        <footer className="border-t border-[#E2E8F0] bg-[#FFFFFF] py-4 px-6 text-center text-xs text-[#64748B]">
          <p>Lead Catalyst CRM · Enterprise Sales Dialer · SIM Telephony & Supabase Cloud</p>
        </footer>
      </body>
    </html>
  );
}
