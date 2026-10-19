import {createServerFn} from '@tanstack/react-start'
import {getRequest} from '@tanstack/react-start/server'
import {z} from 'zod'
import {requireSupabaseAuth} from '@/integrations/supabase/auth-middleware'
import {destinationPhone} from './dialer'

/** Admin: point a Twilio number at the caller-ID webhook and forward calls to a rep phone. */
export const connectInboundNumber=createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
  .inputValidator((i:unknown)=>z.object({phone:z.string().regex(/^\+\d{8,15}$/),forwardTo:z.string()}).parse(i))
  .handler(async({data,context})=>{
    const {data:admin,error:roleError}=await context.supabase.rpc('crm_is_admin');if(roleError)throw roleError
    if(!admin)throw new Error('Only admins can connect phone lines')
    const forwardTo=destinationPhone(data.forwardTo)
    const {twilioGateway}=await import('./twilio.server')
    const list=await (await twilioGateway(`/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(data.phone)}`)).json() as {incoming_phone_numbers:{sid:string;phone_number:string}[]}
    const num=list.incoming_phone_numbers[0];if(!num)throw new Error('That number is not in your Twilio account')
    const {data:org}=await context.supabase.from('user_roles').select('organization_id').eq('user_id',context.userId).single()
    const {supabaseAdmin}=await import('@/integrations/supabase/client.server')
    const {data:existing}=await supabaseAdmin.from('inbound_numbers').select('organization_id').eq('phone_number',num.phone_number).maybeSingle()
    if(existing&&existing.organization_id!==org!.organization_id)throw new Error('This number is already used by another workspace')
    const origin=new URL(getRequest().url).origin
    await twilioGateway(`/IncomingPhoneNumbers/${num.sid}.json`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({VoiceUrl:`${origin}/api/public/twilio/voice`,VoiceMethod:'POST'})})
    const {error}=await supabaseAdmin.from('inbound_numbers').upsert({organization_id:org!.organization_id,phone_number:num.phone_number,provider_sid:num.sid,forward_to:forwardTo},{onConflict:'phone_number'})
    if(error)throw error
    return {phone:num.phone_number,webhook:`${origin}/api/public/twilio/voice`}
  })
