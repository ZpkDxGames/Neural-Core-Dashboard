import type {NextRequest} from 'next/server';
import {dispatch} from '../../../../../lib/auth/owner-dispatch.ts';
export const dynamic='force-dynamic';
export const runtime='nodejs';

export async function GET(req:NextRequest,ctx:{params:Promise<{action:string}>}):Promise<Response>{
  return dispatch(req,(await ctx.params).action,'GET');
}
export async function POST(req:NextRequest,ctx:{params:Promise<{action:string}>}):Promise<Response>{
  return dispatch(req,(await ctx.params).action,'POST');
}
