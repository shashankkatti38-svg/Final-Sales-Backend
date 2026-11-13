import { Resend } from 'resend'

const resendApiKey = process.env['RESEND_API_KEY']

if (!resendApiKey) {
  console.warn('[resend] RESEND_API_KEY is not set — email sending will be unavailable.')
}

/** Shared Resend client. Import this wherever you need to send email. */
export const resend = new Resend(resendApiKey ?? '')

/** Sender address used for all outbound CRM emails. */
export const EMAIL_FROM = process.env['RESEND_FROM_EMAIL'] || 'SalesWorks360 <onboarding@resend.dev>'

