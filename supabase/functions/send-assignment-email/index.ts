import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend";

interface AssignmentEventPayload {
  type?: "task_assignment" | "project_assignment" | "lead_assignment" | "task" | "lead";
  event?: "INSERT" | "UPDATE";
  record?: Record<string, any>;
  assignment_id?: string;
  task_id?: string;
  lead_id?: string;
  user_id?: string; // Recipient authenticated user ID
  assigned_by?: string; // Assigner user ID
  assigned_role?: "Manager" | "Developer" | string;
  organization_id?: string;
  title?: string;
  description?: string;
  due_at?: string;
  priority?: string;
  metadata?: Record<string, any>;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const result = {
    received: true,
    validated: false,
    email_sent: false,
    assignment_preserved: true,
    recipient_email: null as string | null,
    message: "",
    error: null as string | null,
  };

  try {
    // 1. Parse JSON payload
    let rawBody: any = {};
    try {
      rawBody = await req.json();
    } catch {
      return new Response(
        JSON.stringify({
          ...result,
          error: "Invalid JSON payload.",
          message: "Could not parse JSON body.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload: AssignmentEventPayload = rawBody;
    const webhookRecord = payload.record ?? {};

    // Normalize IDs from direct payload or webhook record
    const assignmentId = payload.assignment_id || webhookRecord.id;
    const taskId = payload.task_id || webhookRecord.task_id;
    const leadId = payload.lead_id || webhookRecord.lead_id;
    const recipientUserId = payload.user_id || webhookRecord.user_id || webhookRecord.assigned_to;
    const assignerUserId = payload.assigned_by || webhookRecord.assigned_by;
    const organizationId = payload.organization_id || webhookRecord.organization_id;
    const assignedRole = payload.assigned_role || webhookRecord.assigned_role || "Developer";
    const isProject = payload.type === "project_assignment" || (!taskId && Boolean(leadId));

    // Initialize Supabase Admin client with Service Role Key
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      console.error("[send-assignment-email] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
      result.error = "Supabase server credentials not configured.";
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 2. Validate recipient existence and permissions
    if (!recipientUserId) {
      result.error = "No recipient user ID provided in assignment event.";
      result.message = "Validation failed: recipient user_id is required.";
      console.warn("[send-assignment-email]", result.error);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Role and organization verification
    const { data: userRoleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role, organization_id")
      .eq("user_id", recipientUserId)
      .maybeSingle();

    const normalizedRole = (userRoleRow?.role || "").trim().toLowerCase();
    const isManagerRole =
      normalizedRole === "manager" ||
      normalizedRole === "sales manager" ||
      normalizedRole === "team leader";
    const isDeveloperRole =
      normalizedRole === "developer" ||
      normalizedRole.includes("dev");

    // Enforce role matches requested assignment target
    if (assignedRole === "Manager" && !isManagerRole) {
      result.error = `Recipient role mismatch: expected Manager role, got '${userRoleRow?.role || "none"}'.`;
      result.message = "Skipped notification: recipient is not registered as a Manager.";
      console.warn("[send-assignment-email]", result.error);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (assignedRole === "Developer" && !isDeveloperRole) {
      result.error = `Recipient role mismatch: expected Developer role, got '${userRoleRow?.role || "none"}'.`;
      result.message = "Skipped notification: recipient is not registered as a Developer.";
      console.warn("[send-assignment-email]", result.error);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Deduplication check: Prevent duplicate notifications within 5 minutes for the same assignment event
    if (taskId) {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: recentSentLogs } = await supabaseAdmin
        .from("task_activity_log")
        .select("id")
        .eq("task_id", taskId)
        .eq("action", "assignment_email_sent")
        .gte("created_at", fiveMinutesAgo)
        .limit(1);

      if (recentSentLogs && recentSentLogs.length > 0) {
        result.message = "Duplicate notification suppressed: email already sent for this task recently.";
        result.email_sent = false;
        result.assignment_preserved = true;
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (leadId) {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: recentAuditLogs } = await supabaseAdmin
        .from("company_audit_logs")
        .select("id, details")
        .eq("action", "project_email_sent")
        .gte("created_at", fiveMinutesAgo)
        .limit(10);

      const isDuplicate = recentAuditLogs?.some(
        (log: any) => log.details?.lead_id === leadId && log.details?.user_id === recipientUserId
      );

      if (isDuplicate) {
        result.message = "Duplicate notification suppressed: email already sent for this project assignment recently.";
        result.email_sent = false;
        result.assignment_preserved = true;
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Retrieve recipient profile
    const { data: recipientProfile } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name")
      .eq("id", recipientUserId)
      .maybeSingle();

    // Retrieve assigner profile
    let assignerName = assignedRole === "Developer" ? "Manager" : "SalesWorks360 Admin";
    if (assignerUserId) {
      const { data: assignerProfile } = await supabaseAdmin
        .from("profiles")
        .select("display_name")
        .eq("id", assignerUserId)
        .maybeSingle();
      if (assignerProfile?.display_name) {
        assignerName = assignerProfile.display_name;
      }
    }

    // Fetch details of the Task or Project (Privacy rule: NEVER include customer phone, email, or deal value)
    let itemTitle = payload.title || (isProject ? "New Assigned Project" : "New Management Task");
    let itemDetails = payload.description || "";
    let itemDue = payload.due_at || "";
    let itemPriority = payload.priority || "Medium";
    let targetOrgId = organizationId || userRoleRow?.organization_id;

    if (taskId) {
      const { data: taskData } = await supabaseAdmin
        .from("tasks")
        .select("id, title, notes, description, due_at, priority, organization_id, created_by")
        .eq("id", taskId)
        .maybeSingle();

      if (taskData) {
        itemTitle = taskData.title || itemTitle;
        itemDetails = taskData.notes || taskData.description || itemDetails;
        itemDue = taskData.due_at || itemDue;
        itemPriority = taskData.priority || itemPriority;
        targetOrgId = targetOrgId || taskData.organization_id;
      }
    } else if (leadId) {
      // Query project lead: STRICTLY only name, company, and address (project scope). No phone, email, or value.
      const { data: leadData } = await supabaseAdmin
        .from("leads")
        .select("id, name, company, address, organization_id")
        .eq("id", leadId)
        .maybeSingle();

      if (leadData) {
        itemTitle = leadData.company || leadData.name || itemTitle;
        itemDetails = leadData.address || itemDetails;
        targetOrgId = targetOrgId || leadData.organization_id;
      }
    }

    result.validated = true;

    // 3. Retrieve employee registered email strictly from auth.users (Secure Server-Side Lookup)
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(recipientUserId);
    const recipientEmail = authUser?.user?.email?.trim() || null;

    if (!recipientEmail) {
      result.error = `No registered email found for employee ID: ${recipientUserId}`;
      result.message = "Recipient has no email registered in auth.users. Assignment remains intact.";
      console.warn("[send-assignment-email]", result.error);

      if (taskId && targetOrgId) {
        await supabaseAdmin.from("task_activity_log").insert({
          task_id: taskId,
          organization_id: targetOrgId,
          actor_id: assignerUserId || null,
          action: "assignment_email_skipped",
          details: { reason: "Missing employee email", user_id: recipientUserId },
        });
      }

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    result.recipient_email = recipientEmail;

    // 4. Prepare professional SalesWorks360 branded email template
    const formattedDue = itemDue
      ? new Date(itemDue).toLocaleDateString("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "Not specified";

    const assignmentDate = new Date().toLocaleDateString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });

    const isDeveloper = assignedRole === "Developer" || isDeveloperRole;
    const recipientDisplayName = recipientProfile?.display_name || (isDeveloper ? "Developer" : "Manager");
    const assignmentTypeLabel = isProject ? "Project Assignment" : isDeveloper ? "Technical Task" : "Management Task";
    const portalUrl = isDeveloper ? "https://salesworks360.com/" : "https://salesworks360.com/tasks";
    const buttonText = isDeveloper ? "Open Developer Portal" : "View Task in CRM";
    const emailSubject = isProject
      ? `Project Assigned: ${itemTitle}`
      : `Task Assigned: ${itemTitle}`;

    const greetingMessage = isDeveloper
      ? `A new ${isProject ? "project" : "technical task"} has been assigned to you by <strong>${assignerName}</strong>. Please log in to your Developer Portal to view the technical requirements, execution details, and track your progress.`
      : `A new management task has been assigned to you by <strong>${assignerName}</strong>. Please review the assignment details below:`;

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${emailSubject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 24px; color: #0f172a;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(15,23,42,0.06);">
    <!-- Header -->
    <tr>
      <td style="background-color: #0f172a; padding: 28px 32px; border-bottom: 3px solid #2563eb;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td>
              <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.3px;">
                SalesWorks360 CRM
              </h1>
              <p style="color: #94a3b8; margin: 4px 0 0 0; font-size: 13px; font-weight: 500;">
                ${assignmentTypeLabel} Notification
              </p>
            </td>
            <td align="right">
              <span style="display: inline-block; background-color: #1e293b; color: #38bdf8; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 9999px; text-transform: uppercase;">
                ${itemPriority} Priority
              </span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Body -->
    <tr>
      <td style="padding: 32px;">
        <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 24px;">
          Hello <strong>${recipientDisplayName}</strong>,
        </p>
        <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 22px; color: #475569;">
          ${greetingMessage}
        </p>

        <!-- Assignment Card -->
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 24px;">
          <tr>
            <td style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0;">
              <span style="font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">${isProject ? "Project Title" : "Task Title"}</span>
              <div style="font-size: 16px; font-weight: 700; color: #0f172a; margin-top: 4px;">${itemTitle}</div>
            </td>
          </tr>
          ${
            itemDetails
              ? `<tr>
            <td style="padding: 14px 20px; border-bottom: 1px solid #e2e8f0;">
              <span style="font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">${isProject ? "Requirements / Scope" : "Instructions / Notes"}</span>
              <div style="font-size: 14px; color: #334155; margin-top: 4px; line-height: 20px; white-space: pre-wrap;">${itemDetails}</div>
            </td>
          </tr>`
              : ""
          }
          <tr>
            <td style="padding: 14px 20px; border-bottom: 1px solid #e2e8f0;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="50%">
                    <span style="font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Assigned By</span>
                    <div style="font-size: 14px; font-weight: 600; color: #0f172a; margin-top: 2px;">${assignerName}</div>
                  </td>
                  <td width="50%">
                    <span style="font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Assignment Date</span>
                    <div style="font-size: 14px; color: #334155; margin-top: 2px;">${assignmentDate}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 14px 20px;">
              <span style="font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Due Date</span>
              <div style="font-size: 14px; font-weight: 600; color: #2563eb; margin-top: 2px;">${formattedDue}</div>
            </td>
          </tr>
        </table>

        <!-- CTA Button -->
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 28px 0 12px 0;">
          <tr>
            <td align="center">
              <a href="${portalUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 13px 32px; font-size: 14px; font-weight: 600; border-radius: 8px; box-shadow: 0 2px 4px rgba(37,99,235,0.2);">
                ${buttonText}
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 32px; text-align: center;">
        <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 18px;">
          This is an automated operational notification from SalesWorks360 CRM.<br>
          Please log in to your portal to manage and update your deliverables.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();

    // 5. Send email via Resend
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const senderEmail = Deno.env.get("RESEND_FROM_EMAIL") || "SalesWorks360 <onboarding@resend.dev>";

    if (!resendApiKey) {
      result.error = "RESEND_API_KEY is not configured in edge environment.";
      result.message = "Skipped sending: missing RESEND_API_KEY.";
      console.error("[send-assignment-email]", result.error);

      if (taskId && targetOrgId) {
        await supabaseAdmin.from("task_activity_log").insert({
          task_id: taskId,
          organization_id: targetOrgId,
          actor_id: assignerUserId || null,
          action: "assignment_email_unconfigured",
          details: { error: result.error, recipient: recipientEmail },
        });
      }

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resend = new Resend(resendApiKey);

    const { data: resendData, error: resendError } = await resend.emails.send({
      from: senderEmail,
      to: recipientEmail,
      subject: emailSubject,
      html: emailHtml,
    });

    // 6 & 7. Record delivery result and preserve assignment
    if (resendError) {
      result.error = resendError.message || "Failed to send email via Resend.";
      result.message = "Resend API error encountered. Assignment preserved.";
      console.error("[send-assignment-email] Resend error:", resendError);

      if (taskId && targetOrgId) {
        await supabaseAdmin.from("task_activity_log").insert({
          task_id: taskId,
          organization_id: targetOrgId,
          actor_id: assignerUserId || null,
          action: "assignment_email_failed",
          details: {
            error: resendError,
            recipient: recipientEmail,
            assignment_id: assignmentId,
          },
        });
      }

      if (isProject && targetOrgId) {
        await supabaseAdmin.from("company_audit_logs").insert({
          target_organization_id: targetOrgId,
          actor_id: assignerUserId || null,
          action: "project_email_failed",
          details: {
            error: resendError,
            recipient: recipientEmail,
            lead_id: leadId,
            user_id: recipientUserId,
          },
        });
      }

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Success
    result.email_sent = true;
    result.message = `Assignment email successfully sent to ${assignedRole} (${recipientEmail}).`;

    if (taskId && targetOrgId) {
      await supabaseAdmin.from("task_activity_log").insert({
        task_id: taskId,
        organization_id: targetOrgId,
        actor_id: assignerUserId || null,
        action: "assignment_email_sent",
        details: {
          resend_id: resendData?.id,
          recipient: recipientEmail,
          assignment_id: assignmentId,
        },
      });
    }

    if (isProject && targetOrgId) {
      await supabaseAdmin.from("company_audit_logs").insert({
        target_organization_id: targetOrgId,
        actor_id: assignerUserId || null,
        action: "project_email_sent",
        details: {
          resend_id: resendData?.id,
          recipient: recipientEmail,
          lead_id: leadId,
          user_id: recipientUserId,
        },
      });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[send-assignment-email] Unhandled exception:", err);
    result.error = err?.message || "Unexpected internal error.";
    result.message = "Unhandled error during email delivery. Assignment was not affected.";

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
