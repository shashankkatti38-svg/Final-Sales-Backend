export async function twilioGateway(path:string,init?:RequestInit){
  const key=process.env['LOVABLE_API_KEY'];const connection=process.env['TWILIO_API_KEY']
  if(!key||!connection)throw new Error('Connect Twilio first')
  const response=await fetch(`https://connector-gateway.lovable.dev/twilio${path}`,{...init,headers:{Authorization:`Bearer ${key}`,'X-Connection-Api-Key':connection,...init?.headers}})
  if(!response.ok){const body=await response.text();console.error(`Twilio gateway [${response.status}]: ${body}`);let message=body;try{message=JSON.parse(body).message??body}catch{/* raw */}throw new Error(`Calling service (${response.status}): ${message}`)}
  return response
}
/** Last 10 digits — matches +91/+1 numbers regardless of formatting. */
export const phoneKey=(v:string)=>v.replace(/\D/g,'').slice(-10)
