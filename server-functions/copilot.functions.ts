import {createServerFn} from '@tanstack/react-start'
import {getRequest} from '@tanstack/react-start/server'
import {z} from 'zod'
import {requireSupabaseAuth} from '@/integrations/supabase/auth-middleware'

type Ctx={supabase:any;userId:string}
async function blocked(ctx:Ctx){const {data}=await ctx.supabase.from('ai_access_state').select('*').eq('owner_id',ctx.userId).maybeSingle();return data?.blocked?{ok:false as const,status:data.status??403,message:data.message as string}:null}
async function persistBlock(ctx:Ctx,r:{ok:boolean;status?:number;message?:string}){if(!r.ok&&(r.status===402||r.status===403)){const {supabaseAdmin}=await import('@/integrations/supabase/client.server');await supabaseAdmin.from('ai_access_state').upsert({owner_id:ctx.userId,blocked:true,status:r.status,message:r.message??'AI unavailable'})}}

const planSchema=z.object({items:z.array(z.object({leadId:z.string(),priority:z.enum(['High','Medium','Low']),action:z.string(),reason:z.string()}))})
/** AI Sales Copilot: reviews open leads and recommends next actions. Never sends or changes anything. */
export const copilotPlan=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).handler(async({context})=>{
  const b=await blocked(context);if(b)return b
  const {data:leads}=await context.supabase.from('leads').select('id,name,company,value,status,label,source,created_at,contacted').not('status','in','("Delivered","Lost")').order('created_at',{ascending:false}).limit(40)
  if(!leads?.length)return {ok:true as const,items:[]}
  const ids=leads.map(l=>l.id)
  const [{data:acts},{data:tasks},{data:docs}]=await Promise.all([context.supabase.from('activities').select('lead_id,type,notes,occurred_at').in('lead_id',ids).order('occurred_at',{ascending:false}).limit(300),context.supabase.from('tasks').select('lead_id,title,due_at,completed').in('lead_id',ids).eq('completed',false),context.supabase.from('sales_documents').select('lead_id,kind,status,total,created_at').in('lead_id',ids)])
  const profile=leads.map(l=>({...l,recent:(acts??[]).filter(a=>a.lead_id===l.id).slice(0,5).map(a=>({type:a.type,notes:a.notes.slice(0,200),at:a.occurred_at})),openTasks:(tasks??[]).filter(t=>t.lead_id===l.id).map(t=>({title:t.title,due:t.due_at})),documents:(docs??[]).filter(d=>d.lead_id===l.id).map(d=>({kind:d.kind,status:d.status,total:d.total}))}))
  const {aiJson}=await import('./ai-json.server')
  const r=await aiJson(getRequest(),planSchema,`You are a sales copilot for an Indian CRM (amounts in INR). Today is ${new Date().toISOString().slice(0,10)}. Pick up to 10 leads that most need attention and give one concrete next action each (under 160 characters) with a short reason (under 200 characters). Use the exact lead id given.`,profile)
  await persistBlock(context,r);if(!r.ok)return r
  const valid=new Set(ids);return {ok:true as const,items:r.data.items.filter(i=>valid.has(i.leadId)).slice(0,10).map(i=>({...i,action:i.action.slice(0,200),reason:i.reason.slice(0,300)}))}
})

const voiceSchema=z.object({summary:z.string(),tasks:z.array(z.object({title:z.string(),daysFromNow:z.number(),type:z.string()}))})
/** AI Voice Notes: transcribe a task's voice note and propose follow-up tasks (the user decides which to create). */
export const voiceNoteTasks=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator((i:unknown)=>z.object({taskId:z.string().uuid()}).parse(i)).handler(async({data,context})=>{
  const b=await blocked(context);if(b)return b
  const key=process.env['LOVABLE_API_KEY'];if(!key)return {ok:false as const,status:401,message:'AI is not configured.'}
  const {data:task}=await context.supabase.from('tasks').select('id,title,audio_path,lead_id').eq('id',data.taskId).single()
  if(!task?.audio_path)return {ok:false as const,status:404,message:'This task has no voice note.'}
  const {data:blob,error}=await context.supabase.storage.from('task-audio').download(task.audio_path)
  if(error||!blob)return {ok:false as const,status:404,message:'Could not open the voice note.'}
  if(blob.size>10*1024*1024)return {ok:false as const,status:400,message:'Voice note is too long.'}
  const form=new FormData();form.append('model','openai/gpt-transcribe');form.append('file',new File([blob],'note.webm',{type:blob.type||'audio/webm'}));form.append('response_format','json')
  const tr=await fetch('https://ai.gateway.lovable.dev/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${key}`},body:form})
  if(!tr.ok){const t=await tr.text();let m=t;try{m=JSON.parse(t).message??JSON.parse(t).error?.message??t}catch{/* raw */}const r={ok:false as const,status:tr.status,message:`Transcription failed: ${m}`};await persistBlock(context,r);return r}
  const transcript=String(((await tr.json()) as {text?:string}).text??'').trim().slice(0,20000)
  if(!transcript)return {ok:false as const,status:422,message:'No speech was detected in this voice note.'}
  const {aiJson}=await import('./ai-json.server')
  const r=await aiJson(getRequest(),voiceSchema,'From a sales rep voice note, write a one-sentence summary and propose up to 3 follow-up tasks the rep explicitly mentioned or clearly implied. Each title under 120 characters; daysFromNow 0-30; type one of Follow-up, Call, Meeting, WhatsApp, Email, Site visit, Demo.',{taskTitle:task.title,transcript})
  await persistBlock(context,r)
  if(!r.ok)return {ok:true as const,transcript,summary:'',tasks:[] as {title:string;daysFromNow:number;type:string}[],leadId:task.lead_id}
  return {ok:true as const,transcript,summary:r.data.summary.slice(0,400),tasks:r.data.tasks.slice(0,3).map(t=>({title:t.title.slice(0,200),daysFromNow:Math.min(30,Math.max(0,Math.round(t.daysFromNow))),type:t.type.slice(0,40)})),leadId:task.lead_id}
})

const contentSchema=z.object({items:z.array(z.object({id:z.string(),reason:z.string()}))})
/** Smart Content Sharing: pick the pages, files and templates that fit this lead. */
export const recommendContent=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator((i:unknown)=>z.object({leadId:z.string().uuid()}).parse(i)).handler(async({data,context})=>{
  const b=await blocked(context);if(b)return b
  const [{data:lead},{data:acts},{data:pages},{data:files}]=await Promise.all([context.supabase.from('leads').select('name,company,status,label,source,value').eq('id',data.leadId).single(),context.supabase.from('activities').select('type,notes').eq('lead_id',data.leadId).order('occurred_at',{ascending:false}).limit(15),context.supabase.from('content_pages').select('id,title,tag,category,body'),context.supabase.from('content_files').select('id,name,tag,description')])
  const library=[...(pages??[]).map(p=>({id:p.id,kind:p.category==='Message'?'template':'page',title:p.title,tag:p.tag,preview:p.body.slice(0,200)})),...(files??[]).map(f=>({id:f.id,kind:'file',title:f.name,tag:f.tag,preview:f.description.slice(0,200)}))]
  if(!library.length)return {ok:true as const,items:[]}
  const {aiJson}=await import('./ai-json.server')
  const r=await aiJson(getRequest(),contentSchema,'Recommend up to 3 items from the content library that best match this lead\'s interests and stage. Use exact ids from the library; reason under 150 characters.',{lead,recentNotes:(acts??[]).map(a=>`${a.type}: ${a.notes.slice(0,200)}`),library})
  await persistBlock(context,r);if(!r.ok)return r
  const byId=new Map(library.map(l=>[l.id,l]));return {ok:true as const,items:r.data.items.filter(i=>byId.has(i.id)).slice(0,3).map(i=>({...byId.get(i.id)!,reason:i.reason.slice(0,200)}))}
})
