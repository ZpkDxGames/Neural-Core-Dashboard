import type { NextRequest } from 'next/server';
import { loadOwnerController } from '../../../../../lib/auth/owner-runtime';
import { noStore, OwnerConfigError } from '../../../../../lib/auth/owner-core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const methods: Record<string, 'GET'|'POST'> = {
  start:'GET',callback:'GET',session:'GET',logout:'POST',rotate:'POST'
};
function json(status:number,error:string):Response{
  const headers=noStore();
  headers.set('Content-Type','application/json; charset=utf-8');
  return new Response(JSON.stringify({error}),{status,headers});
}
async function dispatch(req:NextRequest,context:{params:Promise<{action:string}>},method:'GET'|'POST'):Promise<Response>{
  const {action}=await context.params;
  if(!(action in methods))return json(404,'NOT_FOUND');
  if(methods[action]!==method)return json(405,'METHOD_NOT_ALLOWED');
  try {
    // No env/Redis/OIDC credentials = no usable login/session endpoints.
    const controller=await loadOwnerController();
    if(!controller)return json(503,'AUTH_NOT_CONFIGURED');
    switch(action){
      case 'start': return controller.start(req);
      case 'callback': return controller.callback(req);
      case 'session': return controller.session(req);
      case 'logout': return controller.logout(req);
      case 'rotate': return controller.rotate(req);
      default: return json(404,'NOT_FOUND');
    }
  } catch (error) {
    // Server logs receive only a predefined diagnostic identifier, never values, user
    // identity, tokens, stack traces or the exception message. Public response is generic.
    console.error('[neural-core/owner-auth]', error instanceof OwnerConfigError ? error.code : 'AUTH_RUNTIME_UNAVAILABLE');
    return json(503,'AUTH_UNAVAILABLE');
  }
}
export async function GET(req:NextRequest,ctx:{params:Promise<{action:string}>}):Promise<Response>{
  return dispatch(req,ctx,'GET');
}
export async function POST(req:NextRequest,ctx:{params:Promise<{action:string}>}):Promise<Response>{
  return dispatch(req,ctx,'POST');
}
