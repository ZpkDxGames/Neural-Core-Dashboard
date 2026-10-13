import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { database } from '../../../../lib/db';
import { parseArchive } from '../../../../lib/archive';
export const runtime='nodejs';
export const dynamic='force-dynamic';
function authorized(req: NextRequest): boolean {
  const expected=process.env.CORE_INGEST_TOKEN;
  const provided=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||'';
  if (!expected || expected.length<32 || !provided || provided.length!==expected.length) return false;
  return timingSafeEqual(Buffer.from(provided),Buffer.from(expected));
}
export async function POST(req: NextRequest) {
  if(!process.env.DATABASE_URL||!process.env.CORE_INGEST_TOKEN)return NextResponse.json({error:'Backend is disabled'},{status:503});
  if(!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401});
  if (!req.headers.get('content-type')?.includes('application/json')) return NextResponse.json({error:'JSON required'},{status:415});
  const len=Number(req.headers.get('content-length')||0);
  if(len>512000) return NextResponse.json({error:'Payload too large'},{status:413});
  let raw:string;
  try {raw=await req.text();if(Buffer.byteLength(raw,'utf8')>512000)return NextResponse.json({error:'Payload too large'},{status:413});}
  catch{return NextResponse.json({error:'Unreadable body'},{status:400});}
  let parsed;
  try {parsed=parseArchive(JSON.parse(raw));}
  catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Invalid archive'},{status:400});}
  if(parsed.conversations.length>50)return NextResponse.json({error:'Max 50 conversations per request'},{status:400});
  const client=await database().connect().catch(()=>null);
  if(!client)return NextResponse.json({error:'Database unavailable'},{status:503});
  try {
    await client.query('BEGIN');
    for(const c of parsed.conversations){
      await client.query(`INSERT INTO conversations(id,source_id,title,created_at,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,updated_at=EXCLUDED.updated_at,received_at=now()`,[c.id,c.provider,c.title,c.createdAt,c.updatedAt]);
      for(const m of c.messages.slice(0,500)){
        await client.query(`INSERT INTO messages(conversation_id,message_id,role,body,written_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(conversation_id,message_id) DO UPDATE SET role=EXCLUDED.role,body=EXCLUDED.body,written_at=EXCLUDED.written_at`,[c.id,m.id,m.role,m.text,m.at]);
      }
    }
    await client.query('COMMIT');
    return NextResponse.json({imported:parsed.conversations.length,ignored:parsed.ignored},{headers:{'Cache-Control':'no-store'}});
  } catch {
    await client.query('ROLLBACK').catch(()=>{});
    return NextResponse.json({error:'Import failed; no partial write committed'},{status:500});
  } finally {client.release();}
}
