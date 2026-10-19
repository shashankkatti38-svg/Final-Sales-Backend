export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    service: "LeadConnect CRM API",
    status: "healthy",
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
