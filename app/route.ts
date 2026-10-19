import { checkDatabaseConnection } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const dbHealth = await checkDatabaseConnection();

  return Response.json({
    service: "LeadConnect CRM API",
    status: dbHealth.connected ? "healthy" : "degraded",
    database: {
      status: dbHealth.connected ? "connected" : "error",
      target: "supabase-postgresql",
      leadsTableAvailable: dbHealth.connected,
      error: dbHealth.error || null,
    },
    timestamp: new Date().toISOString(),
    endpoints: {
      health: "/",
      leads: "/api/leads",
      crmData: "/api/crm/data",
      recordings: "/api/recordings",
      recordingSync: "/api/recordings/sync-call",
      recordingUploadInitiate: "/api/recordings/upload/initiate",
      recordingUploadComplete: "/api/recordings/upload/complete",
      twilioVoice: "/api/public/twilio/voice",
    },
  });
}
