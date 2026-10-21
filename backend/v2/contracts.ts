/** Version 2 internal contracts. No browser adapter or public ingress is authorized. */
export type Role = 'viewer' | 'contributor' | 'maintainer' | 'owner';
export type NoteType = 'fact'|'project'|'decision'|'reference';
export type Scope = 'read' | 'propose' | 'review' | 'delete' | 'export' | `type:${NoteType}`;
export interface AgentIdentity {
  principalId: string; ownerId: string; displayName: string;
  kind: 'owner' | 'agent'; role: Role; scopes: Scope[];
}
export interface EvidenceRef {
  kind: 'conversation' | 'manual'; conversationId?: string; messageId?: string;
  spanStart?: number; spanEnd?: number; reason?: string;
}
export interface Relation { targetId: string; type: 'related'|'supports'|'contradicts'|'derived-from'|'link'|'supersedes'; evidenceOrdinal: number; confidence?: number }
export interface NoteInput { title: string; body: string; type: NoteType; tags: string[]; evidence: EvidenceRef[]; relations: Relation[] }
export interface Proposal { proposalId: string; noteId: string|null; baseRevision: number; payload: NoteInput; state: 'proposed'|'accepted'|'rejected'|'conflict' }
export interface Revision { noteId: string; revision: number; baseRevision: number; contentHash: string; markdown: string; principalId: string }
export interface Publication { eventId: string; noteId: string; revision: number; operation: 'publish'|'delete'; state: 'pending'|'committed'|'failed'|'conflict'|'cancelled' }
export interface Conflict { editId: string; noteId: string|null; code: string; proposalId?: string }
export interface Note extends NoteInput { noteId: string; revision: number; trust: 'proposed'|'verified'|'rejected'; publishedHash: string; verifiedAt?: string; verifiedBy?: string }
export interface GraphSubgraph { nodes: Omit<Note,'body'>[]; edges: Relation[]; partial: boolean; nextCursor: string|null }
export interface VaultPort {
  read(ownerId: string,fileName: string): Promise<{text:string;hash:string}|null>;
  publish(ownerId: string,fileName: string,text: string,expectedHash:string|null): Promise<string>;
  remove(ownerId:string,fileName:string,expectedHash:string|null):Promise<void>;
  list(ownerId:string,after?:string,limit?:number):Promise<{files:string[];nextCursor:string|null}>;
  inventory(ownerId:string,options:{quiesced:true;maxEntries?:number;maxNameBytes?:number}):Promise<{files:string[];stamp:string;scanned:number;estimatedNameBytes:number}>;
  inventoryStamp(ownerId:string):Promise<string>;
}

/** GET wire contract. Distinct from the UI adapter's camel-case Proposal. */
export type ProposalState = 'proposed'|'conflict'|'accepted'|'rejected';
export interface ProposalListQuery { limit?:number; cursor?:string|null; statuses?:ProposalState[]; noteTypes?:NoteType[] }
export interface ProposalRow {
  proposal_id:string; note_id:string|null; principal_id:string; base_revision:number;
  payload:NoteInput; state:ProposalState; duplicate_of:string|null; created_at:string;
}
export interface ProposalPage { items:ProposalRow[]; nextCursor:string|null; partial:boolean }
