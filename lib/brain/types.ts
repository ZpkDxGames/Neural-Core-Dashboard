// lib/brain/types.ts — canonical UI-facing contracts. These are ADAPTER outputs, not backend payloads:
// the backend contract (MEMORY_DATA_CONTRACTS.md) is a proposal; adapters map defensively and drop unknown fields.
import type { StatusKey } from "./status.ts";
export type { StatusKey } from "./status.ts";

export type DataOrigin = "demo" | "local" | "remote";
export type PageState =
  | "loading"
  | "guest"
  | "consent-required"
  | "empty"
  | "partial"
  | "offline"
  | "pending"
  | "conflict"
  | "error"
  | "archived"
  | "success";
export type ReasonCode =
  | "REMOTE_NOT_CONFIGURED"
  | "CONSENT_NOT_GRANTED"
  | "OWNER_AUTH_DISABLED"
  | "NO_OWNER_SESSION"
  | "NOT_IMPLEMENTED"
  | "ROLE_FORBIDDEN"
  | "NETWORK"
  | "STALE";

export interface SafeError {
  code: string;
  message: string;
  ref?: string;
  retryable: boolean;
  at: string;
}

type Meta = {
  origin: DataOrigin;
  confirmedAt?: string;
  endpoint?: string;
  readAt?: string;
};
export type DataEnvelope<T> = Meta &
  (
    | { state: "loading" }
    | { state: "ready"; data: T }
    | { state: "empty" }
    | { state: "partial"; data: T; missing: string[] }
    | { state: "unavailable"; reason: ReasonCode }
    | { state: "error"; error: SafeError }
  );

export interface Page<T> {
  items: T[];
  nextCursor?: string;
  total?: number /* absent: backend did not report */;
}

export type TrustLevel = "verified" | "proposed" | "heuristic" | "rejected";
export type NodeKind = "note" | "source" | "concept" | "cluster";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  trust: TrustLevel;
  flags: { conflict?: boolean; stale?: boolean };
  degree: number;
  clusterId: string;
  memberCount?: number;
  updatedAt?: string;
  revision?: number;
  origin: DataOrigin;
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  confidence?: number;
  evidenceCount: number;
  directed: boolean;
  origin: DataOrigin;
}
export interface EvidenceRef {
  kind: "conversation" | "document" | "manual" | "agent_proposal" | "other";
  provider?: string;
  sourceId: string;
  sourceRevision?: number;
  messageId?: string;
  span?: { start: number; end: number };
  ingestedAt?: string;
  consent?: "granted" | "declined" | "unknown";
  resolvable?: boolean;
}
export interface ConversationSummary {
  id: string;
  provider: "chatgpt" | "claude" | "generic";
  title: string;
  messageCount: number;
  updatedAt?: string;
}
export interface NoteSummary {
  noteId: string;
  title: string;
  type: string;
  revision: number;
  updatedAt: string;
  tags: string[];
  trust: TrustLevel;
  publication: Extract<StatusKey, `pub.${string}`> | null;
  hasConflict: boolean;
  origin: DataOrigin;
}
export interface NoteDetail extends NoteSummary {
  body: string; // UNTRUSTED Markdown
  selfReported: Record<string, string | string[]>; // allow-listed frontmatter, display only
  evidence: EvidenceRef[];
}
export interface AgentPrincipal {
  agentId: string;
  displayName: string;
  role: "viewer" | "contributor" | "maintainer" | "owner";
  kind?: "agent" | "owner";
  expiresAt?: string;
  scopes: string[];
  disabledAt?: string;
}
export interface Proposal {
  id: string;
  noteId?: string;
  title: string;
  agent: AgentPrincipal;
  scopes: string[];
  createdAt: string;
  evidence: EvidenceRef[];
  evidenceStatus?: { resolvable: number; total: number };
  baseRevision?: number;
  intentSha256?: string;
  body?: string;
  conflictsWith?: string[];
  origin: DataOrigin;
}
export interface LayerStatus {
  layer: "indexeddb" | "gateway" | "vault" | "projection";
  ok: boolean;
  confirmedAt?: string;
  detail?: string;
}
export interface SyncStatusView {
  pending: number;
  publishing: number;
  conflicts: number;
  lastConfirmedPublicationAt?: string;
  layers: LayerStatus[];
}
export interface ConnectionInput {
  remoteConfigured: boolean;
  ownerAuthEnabled: boolean;
  consentGranted: boolean;
  session: "disabled" | "loading" | "signed-out" | "signed-in" | "error";
  online: boolean;
  remote: DataEnvelope<SyncStatusView> | null; // null = never requested
  localQueuedWrites: number;
  now: number;
  staleAfterMs: number;
}

export interface ReviewReceipt {id:string;state?:string;challengeId?:string;noteId?:string;revision?:number;decision?:string;subjectId?:string;expectedRevision?:number;intentSha256?:string;preview?:{title:string;body:string}}
