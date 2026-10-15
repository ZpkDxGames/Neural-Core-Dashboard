import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveSyncState,maySendPrivateData} from '../lib/sync-policy.ts';
const base={approvedIngress:false,authenticated:false,consent:false,networkOnline:true,serverReachable:true,pending:false,conflict:false,lastSyncedAt:null};
test('default and consent-off modes cannot send data',()=>{
  assert.equal(resolveSyncState(base),'Local only');
  assert.equal(maySendPrivateData(base),false);
  assert.equal(maySendPrivateData({...base,approvedIngress:true,authenticated:true}),false);
});
test('all eight statuses reflect actual connection and opt-in state',()=>{
  const active={...base,approvedIngress:true,authenticated:true,consent:true};
  assert.equal(resolveSyncState({...active,authenticated:false}),'Authentication required');
  assert.equal(resolveSyncState(active),'Connected');
  assert.equal(resolveSyncState({...active,pending:true}),'Syncing');
  assert.equal(resolveSyncState({...active,lastSyncedAt:'2026-10-01T00:00:00.000Z'}),'Synced');
  assert.equal(resolveSyncState({...active,conflict:true}),'Conflict');
  assert.equal(resolveSyncState({...active,networkOnline:false}),'Offline');
  assert.equal(resolveSyncState({...active,serverReachable:false}),'Server unavailable');
  assert.equal(maySendPrivateData(active),true);
  assert.equal(maySendPrivateData({...active,serverReachable:false}),false);
});
