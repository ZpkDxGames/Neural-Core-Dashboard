/** Version 2 internal contracts. No browser adapter or public ingress is authorized. */
export type Role = 'viewer' | 'contributor' | 'maintainer' | 'owner';
export type Scope = 'read' | 'propose' | 'review' | 'delete' | 'export';
export interface AgentIdentity {
  principalId: string; ownerId: string; displayName: string;
  kind: 'owner' | 'agent'; role: Role; scopes: Scope[];
}
export interface EvidenceRef {
  kind: 'conversation' | 'manual'; conversationId?: string; messageId?: string;
  spanStart?: number; spanEnd?: number; reason?: string;
}
export interface Relation { targetId: string; type: 'related'|'supports'|'contradicts'|'derived-from'|'link'|'supersedes'; evidenceOrdinal: number; confidence?: number }
export interface NoteInput { title: string; body: string; type: 'fact'|'project'|'decision'|'reference'; tags: string[]; evidence: EvidenceRef[]; relations: Relation[] }
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
}
