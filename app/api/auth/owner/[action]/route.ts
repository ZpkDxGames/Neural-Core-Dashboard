import type { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { loadOwnerController } from '../../../../../lib/auth/owner-runtime.ts';
import { noStore, OwnerConfigError } from '../../../../../lib/auth/owner-core.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const methods: Record<string, 'GET'|'POST'> = {
  start:'GET',callback:'GET',session:'GET',logout:'POST',rotate:'POST'
};
function json(status:number,error:string,reason?:string):Response{
  const headers=noStore();headers.set('Content-Type','application/json; charset=utf-8');
  return new Response(JSON.stringify({error,...(reason?{reason}:{})}),{status,headers});
}
export async function dispatch(req:Request,action:string,method:'GET'|'POST'):Promise<Response>{
  const requestId=randomUUID();
  // Log only server-defined codes. Never log the Request, exception, headers,
  // callback query, provider response, environment values or identity claims.
  const report=(code:string)=>console.error('[neural-core/owner-auth]',JSON.stringify({code,action,requestId}));
  const finish=(response:Response)=>{
    response.headers.set('X-NCore-Auth-Request-Id',requestId);
    const navigation=req.headers.get('sec-fetch-mode')==='navigate'||req.headers.get('accept')?.includes('text/html');
    if((action==='start'||action==='callback')&&navigation&&response.status>=400){
      const headers=noStore();headers.set('Location','/?auth='+(response.status===429?'limited':response.status===409?'origin':'unavailable'));
      headers.set('X-NCore-Auth-Request-Id',requestId);
      return new Response(null,{status:303,headers});
    }
    return response;
  };
  if(!Object.hasOwn(methods,action))return finish(json(404,'NOT_FOUND'));
  if(methods[action]!==method)return finish(json(405,'METHOD_NOT_ALLOWED'));
  try {
    const controller=await loadOwnerController(report);
    if(!controller)return finish(json(503,'AUTH_NOT_CONFIGURED'));
    const response=await controller[action as keyof typeof controller](req);
    return finish(response);
  } catch (error) {
    report(error instanceof OwnerConfigError ? error.code : 'AUTH_RUNTIME_UNAVAILABLE');
    return finish(json(503,'AUTH_UNAVAILABLE',error instanceof OwnerConfigError?'configuration':'runtime'));
  }
}
export async function GET(req:NextRequest,ctx:{params:Promise<{action:string}>}):Promise<Response>{
  return dispatch(req,(await ctx.params).action,'GET');
}
export async function POST(req:NextRequest,ctx:{params:Promise<{action:string}>}):Promise<Response>{
  return dispatch(req,(await ctx.params).action,'POST');
}
