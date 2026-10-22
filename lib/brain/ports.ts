// lib/brain/ports.ts — typed adapters. The DEFAULT remote port performs NO network I/O and reports "unavailable".
import type {
  AgentPrincipal,
  ConversationSummary,
  DataEnvelope,
  GraphEdge,
  GraphNode,
  NoteDetail,
  NoteSummary,
  Page,
  Proposal,
  SyncStatusView,
  ReviewReceipt,
} from "./types.ts";
import { unavailable } from "./envelope.ts";

export interface ListQuery {
  cursor?: string;
  limit: number;
  search?: string;
} // limit is clamped to <= 50 by adapters
export interface LocalLibraryPort {
  listConversations(
    q: ListQuery,
    signal: AbortSignal,
  ): Promise<DataEnvelope<Page<ConversationSummary>>>;
  count(): Promise<DataEnvelope<number>>;
}
export interface VaultPort {
  syncStatus(signal: AbortSignal): Promise<DataEnvelope<SyncStatusView>>;
  listNotes(
    q: ListQuery,
    signal: AbortSignal,
  ): Promise<DataEnvelope<Page<NoteSummary>>>;
  getNote(id: string, signal: AbortSignal): Promise<DataEnvelope<NoteDetail>>;
  graph(
    q: { focus?: string; depth: 1 | 2 | 3; limit: number },
    signal: AbortSignal,
  ): Promise<DataEnvelope<{ nodes: GraphNode[]; edges: GraphEdge[] }>>;
  listProposals(
    q: ListQuery,
    signal: AbortSignal,
  ): Promise<DataEnvelope<Page<Proposal>>>;
  listAgents(signal: AbortSignal): Promise<DataEnvelope<AgentPrincipal[]>>;
  review(
    id: string,
    decision: "verify" | "reject",
    note?: string,
  ): Promise<DataEnvelope<ReviewReceipt>>;
}

export const MAX_PAGE = 50;
export const clampLimit = (n: number): number =>
  Math.max(1, Math.min(MAX_PAGE, Math.floor(n)));

/** Used in every current build: capability absent, no fetch, truthful states. */
export const unavailableVault = (
  reason: "REMOTE_NOT_CONFIGURED" | "NOT_IMPLEMENTED" = "REMOTE_NOT_CONFIGURED",
): VaultPort => {
  const u = <T>() => Promise.resolve(unavailable<T>(reason));
  return {
    syncStatus: u,
    listNotes: u,
    getNote: u,
    graph: u,
    listProposals: u,
    listAgents: u,
    review: u,
  };
};
