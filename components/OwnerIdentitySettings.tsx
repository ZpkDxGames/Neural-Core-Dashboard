'use client';

import { useCallback, useEffect, useState } from 'react';
type OwnerState='checking'|'disabled'|'guest'|'owner'|'unavailable';
type SessionResponse={authenticated?:boolean;csrf?:string;expiresAt?:string};
export function OwnerIdentitySettings(){
  const [state,setState]=useState<OwnerState>('checking');
  const [csrf,setCsrf]=useState<string|null>(null);
  const [expiry,setExpiry]=useState<string|null>(null);
  const [working,setWorking]=useState(false);
  const check=useCallback(async()=>{
    setState('checking');
    try{
      const response=await fetch('/api/auth/owner/session',{cache:'no-store',credentials:'same-origin'});
      if(response.status===503){setState('disabled');return;}
      if(response.status===401){setCsrf(null);setState('guest');return;}
      if(!response.ok)throw Error('Unavailable');
      const body=await response.json() as SessionResponse;
      if(!body.authenticated||typeof body.csrf!=='string')throw Error('Invalid session');
      setCsrf(body.csrf);setExpiry(body.expiresAt??null);setState('owner');
    }catch{setState('unavailable');}
  },[]);
  useEffect(()=>{void check();},[check]);
  async function action(kind:'logout'|'rotate'){
    if(!csrf||working)return;
    setWorking(true);
    try{
      const response=await fetch('/api/auth/owner/'+kind,{
        method:'POST',cache:'no-store',credentials:'same-origin',
        headers:{'x-ncore-csrf':csrf,'content-type':'application/json'}
      });
      if(!response.ok)throw Error('Request failed');
      await check();
    }catch{setState('unavailable');}
    finally{setWorking(false);}
  }
  return <div className="setting-row" aria-label="Google owner authentication">
    <div className="setting-icon" aria-hidden="true">G</div>
    <div>
      <strong>Google owner identity</strong>
      <p role="status">{state==='checking'?'Checking private session…':
        state==='disabled'?'Not configured. No Google login or server sync is enabled.':
        state==='guest'?'Google login is available; you are signed out.':
        state==='owner'?'Owner session active'+(expiry?' until '+new Date(expiry).toLocaleString():'')+'. No server sync is active.':
        'Authentication service unavailable. Local archive is unaffected.'}</p>
    </div>
    {state==='guest'?<a className="light-button" href="/api/auth/owner/start">Sign in with Google</a>:null}
    {state==='owner'?<div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <button className="light-button" type="button" disabled={working} onClick={()=>void action('rotate')}>Rotate session</button>
      <button className="light-button" type="button" disabled={working} onClick={()=>void action('logout')}>Sign out</button>
    </div>:null}
    {state==='unavailable'?<button className="light-button" type="button" onClick={()=>void check()}>Retry</button>:null}
  </div>;
}
