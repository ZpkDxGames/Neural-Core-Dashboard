'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
type OwnerState='checking'|'disabled'|'guest'|'owner'|'unavailable'|'wrong-origin';
type SessionState={state:OwnerState;csrf?:string;expiresAt?:string;reason?:string;reference?:string};
const callbackMessages:Record<string,string>={
  failed:'Google sign-in could not be verified. Start a new sign-in attempt.',
  denied:'This Google account is not authorized. Choose the configured owner account.',
  cancelled:'Google sign-in was cancelled. You can try again.',
  unavailable:'Sign-in could not finish because authentication is unavailable. Retry the session check.',
  limited:'Too many sign-in attempts. Wait ten minutes before trying again.',
  origin:'Open the configured Preview address to sign in.'
};
const CHANNEL='neural-core-owner-session';
export function OwnerIdentitySettings(){
  const [session,setSession]=useState<SessionState>({state:'checking'});
  const [working,setWorking]=useState<'logout'|'rotate'|null>(null);
  const [notice,setNotice]=useState('');
  const generation=useRef(0), pending=useRef<AbortController|null>(null);
  const channel=useRef<BroadcastChannel|null>(null);
  const busy=useRef(false);
  const check=useCallback(async()=>{
    if(busy.current)return;
    const sequence=++generation.current;
    pending.current?.abort();
    const abort=new AbortController();pending.current=abort;
    const timeout=setTimeout(()=>abort.abort(),10000);
    setSession({state:'checking'});
    try{
      const response=await fetch('/api/auth/owner/session',{cache:'no-store',credentials:'same-origin',signal:abort.signal});
      const body=await response.json().catch(()=>null);
      if(sequence!==generation.current)return;
      const rawReference=response.headers.get('x-ncore-auth-request-id');
      const reference=rawReference&&/^[a-f0-9-]{36}$/.test(rawReference)?rawReference:undefined;
      if(response.status===503){
        setSession({state:body?.error==='AUTH_NOT_CONFIGURED'?'disabled':'unavailable',reason:body?.reason,reference});return;
      }
      if(response.status===409){setSession({state:'wrong-origin'});return;}
      if(response.status===401){setSession({state:'guest'});return;}
      if(!response.ok||body?.authenticated!==true||typeof body.csrf!=='string'||
        !/^[A-Za-z0-9_-]{43}$/.test(body.csrf)||typeof body.expiresAt!=='string'||
        !Number.isFinite(Date.parse(body.expiresAt))||Date.parse(body.expiresAt)<=Date.now())throw Error('Unavailable');
      setSession({state:'owner',csrf:body.csrf,expiresAt:body.expiresAt});
    }catch{if(sequence===generation.current)setSession({state:'unavailable'});}
    finally{clearTimeout(timeout);}
  },[]);
  useEffect(()=>{
    const url=new URL(window.location.href), result=url.searchParams.get('auth');
    if(result){setNotice(callbackMessages[result]??'');url.searchParams.delete('auth');window.history.replaceState(null,'',url.pathname+url.search+url.hash);}
    if(typeof BroadcastChannel!=='undefined'){
      channel.current=new BroadcastChannel(CHANNEL);
      channel.current.onmessage=()=>void check();
      if(result==='signed-in')channel.current.postMessage('changed');
    }
    const onFocus=()=>void check();
    window.addEventListener('focus',onFocus);
    void check();
    return ()=>{++generation.current;pending.current?.abort();channel.current?.close();window.removeEventListener('focus',onFocus);};
  },[check]);
  useEffect(()=>{
    if(session.state!=='owner'||!session.expiresAt)return;
    const expiry=setTimeout(()=>void check(),Math.max(0,Date.parse(session.expiresAt)-Date.now()+50));
    const refresh=setInterval(()=>{if(document.visibilityState==='visible')void check();},60000);
    return ()=>{clearTimeout(expiry);clearInterval(refresh);};
  },[session.state,session.expiresAt,check]);
  async function action(kind:'logout'|'rotate'){
    if(!session.csrf||busy.current)return;
    busy.current=true;setWorking(kind);setNotice('');
    ++generation.current;pending.current?.abort();
    const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),10000);
    try{
      const response=await fetch('/api/auth/owner/'+kind,{
        method:'POST',cache:'no-store',credentials:'same-origin',signal:abort.signal,
        headers:{'x-ncore-csrf':session.csrf}
      });
      if(response.status===401||response.status===403){
        setNotice('Your session changed. Its status has been checked again.');
      }else if(!response.ok)throw Error('Unavailable');
      channel.current?.postMessage('changed');
      busy.current=false;await check();
    }catch{
      setSession({state:'unavailable'});
      setNotice(kind==='logout'?'Sign-out could not be confirmed. Retry the session check, then sign out again.':'Session refresh could not be confirmed. Retry the session check.');
    }finally{clearTimeout(timeout);busy.current=false;setWorking(null);}
  }
  const state=session.state;
  const unavailable=session.reason==='configuration'
    ?'Google sign-in needs a Preview configuration correction. Review the server diagnostic using the reference below.'
    :session.reason==='storage'?'Session storage is unavailable. Wait a moment, then retry.'
    :'Authentication is temporarily unavailable. Retry the session check.';
  return <div className="setting-row owner-auth" aria-label="Google owner authentication" aria-busy={state==='checking'||Boolean(working)}>
    <div className="setting-icon" aria-hidden="true">G</div>
    <div className="owner-auth-copy">
      <strong>Google owner identity</strong>
      <p role="status" aria-live="polite">{state==='checking'?'Checking private session…':
        state==='disabled'?'Google sign-in is disabled for this deployment.':
        state==='guest'?'Signed out. Sign in with the configured Google owner account.':
        state==='owner'?'Owner session active until '+new Date(session.expiresAt!).toLocaleString()+'.':
        state==='wrong-origin'?'Use the configured Preview address for Google sign-in.':unavailable}</p>
      {notice?<p role="alert">{notice}</p>:null}
      {session.reference?<p className="owner-auth-reference">Support reference: {session.reference}</p>:null}
      <p>Local archive stays on this device. Server synchronization is off.</p>
    </div>
    <div className="owner-auth-actions">
      {state==='guest'?<a className="light-button" href="/api/auth/owner/start" onClick={()=>setNotice('Opening Google sign-in…')}>Sign in with Google</a>:null}
      {state==='owner'?<>
        <button className="light-button" type="button" disabled={Boolean(working)} onClick={()=>void action('rotate')}>{working==='rotate'?'Refreshing…':'Refresh session'}</button>
        <button className="light-button" type="button" disabled={Boolean(working)} onClick={()=>void action('logout')}>{working==='logout'?'Signing out…':'Sign out'}</button>
      </>:null}
      {state==='unavailable'?<button className="light-button" type="button" disabled={Boolean(working)} onClick={()=>void check()}>Retry session check</button>:null}
    </div>
  </div>;
}
