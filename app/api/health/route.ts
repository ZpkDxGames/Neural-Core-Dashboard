import { NextResponse } from 'next/server';
export const dynamic='force-dynamic';
export async function GET() {
  return NextResponse.json({service:'neural-core',version:'0.1.0',mode:process.env.DATABASE_URL && process.env.CORE_INGEST_TOKEN?'backend-configured':'local-first',sync:'manual-only'},{headers:{'Cache-Control':'no-store'}});
}
