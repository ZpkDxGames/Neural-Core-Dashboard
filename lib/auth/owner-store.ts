import { Redis } from '@upstash/redis';
import { AuthDependencyError } from './owner-core.ts';
import type { Store, OwnerConfig } from './owner-core.ts';

// EVAL is a primary/write operation, unlike replica-served GET/EVAL_RO.
// Preserve remaining TTL; a lookup never extends the absolute lifetime.
export const READ_PRIMARY = `
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then return false end
local value = redis.call('GET', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ttl)
return value`;
export const INCREMENT = `
local count = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count`;

export function createAuthRedis(config: Pick<OwnerConfig,'redisUrl'|'redisToken'>) {
  return new Redis({url:config.redisUrl,token:config.redisToken,
    automaticDeserialization:true,enableAutoPipelining:false,enableTelemetry:false,
    readYourWrites:true,retry:{retries:0},signal:()=>AbortSignal.timeout(5000)});
}
export function createOwnerStore(redis: Redis): Store {
  async function guarded<T>(operation:()=>Promise<T>):Promise<T> {
    try{return await operation();}catch{throw new AuthDependencyError('AUTH_STORAGE_UNAVAILABLE');}
  }
  return {
    get<T>(k:string){return guarded(async()=>await redis.eval<[],T|null>(READ_PRIMARY,[k],[]) || null);},
    take<T>(k:string){return guarded(()=>redis.getdel<T>(k));},
    create(k:string,v:unknown,ttl:number){return guarded(async()=>(await redis.set(k,v,{ex:ttl,nx:true}))==='OK');},
    put(k:string,v:unknown,ttl:number){return guarded(async()=>{await redis.set(k,v,{ex:ttl});});},
    remove(k:string){return guarded(async()=>{await redis.del(k);});},
    increment(k:string,ttl:number){return guarded(async()=>{
      const count=await redis.eval<[number],number>(INCREMENT,[k],[ttl]);
      if(!Number.isSafeInteger(count)||count<1)throw Error('Invalid counter');
      return count;
    });}
  };
}
