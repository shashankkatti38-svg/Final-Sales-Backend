import {createServerFn} from '@tanstack/react-start'
import {getRequest} from '@tanstack/react-start/server'
import {z} from 'zod'
import {requireSupabaseAuth} from '@/integrations/supabase/auth-middleware'
export const recommendFollowup=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator((input:unknown)=>z.object({leadId:z.string().uuid(),context:z.string().max(4000)}).parse(input)).handler(async({data,context})=>{
 const {data:state,error:stateError}=await context.supabase.from('ai_access_state').select('*').eq('owner_id',context.userId).maybeSingle();if(stateError)throw stateError;if(state?.blocked)return {ok:false as const,message:state.message,status:state.status??403}
 const {data:lead,error}=await context.supabase.from('leads').select('*').eq('id',data.leadId).single();if(error||!lead)throw new Error('Lead unavailable')
 const {data:activities,error:activityError}=await context.supabase.from('activities').select('type,notes,occurred_at').eq('lead_id',data.leadId).order('occurred_at',{ascending:false}).limit(50);if(activityError)throw activityError
 const {generateFollowup}=await import('./followup.server');const result=await generateFollowup(getRequest(),{lead,timeline:activities??[],context:data.context});if(!result.ok&&(result.status===402||result.status===403)){const {supabaseAdmin}=await import('@/integrations/supabase/client.server');const {error}=await supabaseAdmin.from('ai_access_state').upsert({owner_id:context.userId,blocked:true,status:result.status,message:result.message});if(error)throw error}return result
})