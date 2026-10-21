import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatch} from '../lib/auth/owner-dispatch.ts';
import {environment,origin} from './helpers/owner-fixture.mjs';

test('route diagnostics reveal no values, classify configuration and distinguish disabled auth',async()=>{
  const before={...process.env},logs=[],log=console.error;
  try{
    for(const name of Object.keys(process.env))if(name.startsWith('NCORE_')||name.startsWith('VERCEL_'))delete process.env[name];
    console.error=(...args)=>logs.push(args.join(' '));
    const req=new Request(origin+'/api/auth/owner/session');
    assert.equal((await (await dispatch(req,'session','GET')).json()).error,'AUTH_NOT_CONFIGURED');
    Object.assign(process.env,environment,{NCORE_OWNER_AUTH_ORIGIN:origin+'/secret-private-path'});
    const response=await dispatch(req,'session','GET'),body=await response.json();
    assert.equal(response.status,503);assert.equal(body.reason,'configuration');
    assert.equal(body.error,'AUTH_UNAVAILABLE');
    assert.match(response.headers.get('x-ncore-auth-request-id'),/^[a-f0-9-]{36}$/);
    assert.match(logs.join(' '),/OWNER_ORIGIN_PATH_NOT_ALLOWED/);
    for(const value of Object.values(environment))if(value.length>2)assert.equal(logs.join(' ').includes(value),false);
    assert.equal(logs.join(' ').includes('secret-private-path'),false);
    assert.equal(JSON.stringify(body).includes('OWNER_ORIGIN_PATH'),false);
    assert.equal((await dispatch(req,'__proto__','GET')).status,404);
    assert.equal((await dispatch(req,'logout','GET')).status,405);
    const navigation=await dispatch(new Request(origin+'/api/auth/owner/start',{headers:{accept:'text/html'}}),'start','GET');
    assert.equal(navigation.status,303);assert.equal(navigation.headers.get('location'),'/?auth=unavailable');
  }finally{
    console.error=log;
    for(const name of Object.keys(process.env))if(!(name in before))delete process.env[name];
    Object.assign(process.env,before);
  }
});
