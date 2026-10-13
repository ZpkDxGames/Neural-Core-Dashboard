import { Pool } from 'pg';
let pool: Pool | null=null;
export function database(): Pool {
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL not configured');
  return pool ??= new Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:4500,idleTimeoutMillis:20000,ssl: process.env.CORE_DB_SSL==='require'?{rejectUnauthorized:true}:undefined});
}
