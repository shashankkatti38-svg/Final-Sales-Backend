import { Resend } from 'resend'

let _resendInstance: Resend | null = null
let _currentKey: string | undefined = undefined

function getResendInstance(): Resend {
  const apiKey = process.env['RESEND_API_KEY']
  if (!apiKey) {
    console.warn('[resend] RESEND_API_KEY is not set — email sending will be unavailable.')
  }

  const effectiveKey = apiKey || 're_placeholder_build_key'
  if (!_resendInstance || _currentKey !== effectiveKey) {
    _resendInstance = new Resend(effectiveKey)
    _currentKey = effectiveKey
  }
  return _resendInstance
}

/** Shared Resend client. Safe to import during Next.js build even if RESEND_API_KEY is unset. */
export const resend = new Proxy({} as Resend, {
  get(_target, prop, receiver) {
    const client = getResendInstance()
    const value = Reflect.get(client, prop, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

/** Sender address used for all outbound CRM emails. */
export const EMAIL_FROM = process.env['RESEND_FROM_EMAIL'] || 'SalesWorks360 <onboarding@resend.dev>'


