import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('production OIDC adapter demands pinned Google discovery, signed ID tokens, state, nonce and PKCE',()=>{
  const code=readFileSync(new URL('../lib/auth/owner-runtime.ts',import.meta.url),'utf8');
  assert.match(code,/https:\/\/accounts\.google\.com/);
  assert.match(code,/oidc\.enableNonRepudiationChecks\(cfg\)/);
  assert.match(code,/expectedState:state/);
  assert.match(code,/expectedNonce:nonce/);
  assert.match(code,/pkceCodeVerifier:verifier/);
  assert.match(code,/code_challenge_method:'S256'/);
  assert.match(code,/tokens\.claims\(\)/);
  assert.doesNotMatch(code,/skipStateCheck|allowInsecureRequests|NEXT_PUBLIC_/);
});
test('Next auth endpoint remains independent from Oracle memory API and legacy Vercel DB',()=>{
  const code=readFileSync(new URL('../app/api/auth/owner/[action]/route.ts',import.meta.url),'utf8');
  assert.match(code,/AUTH_NOT_CONFIGURED/);
  assert.match(code,/force-dynamic/);
  assert.match(code,/nodejs/);
  assert.doesNotMatch(code,/DATABASE_URL|CORE_INGEST_TOKEN|4765|NEXT_PUBLIC_/);
});
