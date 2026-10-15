/** Prepared sync policy. Never infer consent or active remote identity from a local archive. */
export const SYNC_STATES=['Local only','Authentication required','Connected','Syncing','Synced','Conflict','Offline','Server unavailable'] as const;
export type SyncState=typeof SYNC_STATES[number];
export type SyncPolicy={
  approvedIngress:boolean; authenticated:boolean; consent:boolean;
  networkOnline:boolean; serverReachable:boolean;
  pending:boolean; conflict:boolean; lastSyncedAt:string|null;
};
export function resolveSyncState(input:SyncPolicy):SyncState {
  if(!input.approvedIngress || !input.consent)return 'Local only';
  if(!input.authenticated)return 'Authentication required';
  if(!input.networkOnline)return 'Offline';
  if(!input.serverReachable)return 'Server unavailable';
  if(input.conflict)return 'Conflict';
  if(input.pending)return 'Syncing';
  return input.lastSyncedAt ? 'Synced' : 'Connected';
}
export function maySendPrivateData(input:SyncPolicy):boolean{
  return input.approvedIngress && input.authenticated && input.consent && input.networkOnline &&
    input.serverReachable && !input.pending && !input.conflict;
}
