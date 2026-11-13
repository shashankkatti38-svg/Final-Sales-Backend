import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'
import { resend, EMAIL_FROM } from '@/lib/resend'

/**
 * Send the AI-generated follow-up email to a lead.
 * The user must explicitly call this after reviewing the AI draft —
 * it is never triggered automatically.
 */
export const sendFollowupEmail = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        leadId: z.string().uuid(),
        to: z.string().email(),
        subject: z.string().min(1).max(150),
        html: z.string().min(1).max(20000),
      })
      .parse(input)
  )
  .handler(async ({ data, context }) => {
    const resendApiKey = process.env['RESEND_API_KEY']
    if (!resendApiKey) {
      return { ok: false as const, status: 503, message: 'Email service is not configured.' }
    }

    // Confirm the lead belongs to this user's organisation before sending.
    const { data: lead, error: leadError } = await context.supabase
      .from('leads')
      .select('id, name, organization_id')
      .eq('id', data.leadId)
      .single()

    if (leadError || !lead) {
      return { ok: false as const, status: 404, message: 'Lead not found.' }
    }

    const { data: sent, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: data.to,
      subject: data.subject,
      html: data.html,
    })

    if (error) {
      console.error('[resend] send failed:', error)
      return { ok: false as const, status: 500, message: error.message ?? 'Email could not be sent.' }
    }

    // Log the sent email as an activity on the lead.
    await context.supabase.from('activities').insert({
      lead_id: data.leadId,
      type: 'Email',
      notes: `Follow-up email sent — subject: "${data.subject}"`,
      occurred_at: new Date().toISOString(),
    })

    return { ok: true as const, emailId: sent?.id }
  })

