import type { VaultPort, ListQuery } from "../ports.ts";
import type {
  AgentPrincipal,
  DataEnvelope,
  NoteSummary,
  NoteDetail,
  Page,
  Proposal,
  EvidenceRef,
  GraphNode,
  GraphEdge,
  SyncStatusView,
  ReviewReceipt,
} from "../types.ts";
import { unavailableVault } from "../ports.ts";
import { neutralizeBidi } from "../links.ts";
type Obj = Record<string, unknown>;
const object = (x: unknown): Obj => {
  if (!x || typeof x !== "object" || Array.isArray(x))
    throw Error("INVALID_REMOTE_RESPONSE");
  return x as Obj;
};
const text = (x: unknown, max = 200000): string => {
  if (typeof x !== "string" || x.length > max)
    throw Error("INVALID_REMOTE_RESPONSE");
  return x;
};
const id = (x: unknown) => {
  const s = text(x, 36);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      s,
    )
  )
    throw Error("INVALID_REMOTE_RESPONSE");
  return s;
};
const integer = (x: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(x) || Number(x) < min || Number(x) > max)
    throw Error("INVALID_REMOTE_RESPONSE");
  return Number(x);
};
const boolean = (x: unknown) => {
  if (typeof x !== "boolean") throw Error("INVALID_REMOTE_RESPONSE");
  return x;
};
const array = (x: unknown, max: number): unknown[] => {
  if (!Array.isArray(x) || x.length > max)
    throw Error("INVALID_REMOTE_RESPONSE");
  return x;
};
const date = (x: unknown) => {
  const s = text(x, 40);
  if (!Number.isFinite(Date.parse(s))) throw Error("INVALID_REMOTE_RESPONSE");
  return s;
};
const cursor = (x: unknown) => (x === null ? undefined : text(x, 1024));
const hex = (x: unknown) => {
  const s = text(x, 64);
  if (!/^[0-9a-f]{64}$/.test(s)) throw Error("INVALID_REMOTE_RESPONSE");
  return s;
};
export function mapNote(value: unknown): NoteSummary {
  const n = object(value),
    trust = n.trust;
  if (trust !== "verified" && trust !== "proposed")
    throw Error("INVALID_REMOTE_RESPONSE");
  if (trust === "verified") {
    id(n.verifiedBy);
    date(n.verifiedAt);
  }
  return {
    noteId: id(n.noteId),
    title: neutralizeBidi(text(n.title, 120)),
    type: text(n.type, 16),
    revision: integer(n.revision, 1),
    updatedAt: date(n.updatedAt),
    tags: array(n.tags, 32).map((x) => text(x, 60)),
    trust,
    publication: boolean(n.pending) ? "pub.pending" : "pub.committed",
    hasConflict: false,
    origin: "remote",
  };
}
function evidence(value: unknown): EvidenceRef[] {
  return array(value, 32).map((x) => {
    const e = object(x);
    if (e.kind === "conversation")
      return {
        kind: "conversation",
        sourceId: text(e.conversationId, 300),
        messageId: text(e.messageId, 300),
        consent: "unknown",
        resolvable: false,
      };
    if (e.kind === "manual")
      return {
        kind: "manual",
        sourceId: "owner-manual-evidence",
        consent: "unknown",
        resolvable: false,
      };
    throw Error("INVALID_REMOTE_RESPONSE");
  });
}
function actor(value: unknown): AgentPrincipal {
  const a = object(value),
    role = a.role,
    kind = a.kind;
  if (
    !["viewer", "contributor", "maintainer", "owner"].includes(String(role)) ||
    !["owner", "agent"].includes(String(kind)) ||
    (kind === "owner") !== (role === "owner")
  )
    throw Error("INVALID_REMOTE_RESPONSE");
  return {
    agentId: id(a.principal_id),
    displayName: neutralizeBidi(text(a.display_name, 120)),
    role: role as AgentPrincipal["role"],
    kind: kind as "owner" | "agent",
    scopes: array(a.scopes, 16).map((x) => text(x, 40)),
    ...(a.disabled_at ? { disabledAt: date(a.disabled_at) } : {}),
    ...(a.credential_expires_at
      ? { expiresAt: date(a.credential_expires_at) }
      : {}),
  };
}
function page<T>(
  value: unknown,
  map: (x: unknown) => T,
): { data: Page<T>; partial: boolean } {
  const p = object(value),
    partial = boolean(p.partial),
    next = cursor(p.nextCursor);
  if (partial !== Boolean(next)) throw Error("INVALID_REMOTE_RESPONSE");
  return {
    data: {
      items: array(p.items, 50).map(map),
      ...(next ? { nextCursor: next } : {}),
    },
    partial,
  };
}
export type Capability = {
  configured: boolean;
  consented: boolean;
  stepUpQualified: boolean;
  remoteSynchronization: false;
};
/** Credentials never enter this adapter. Consent/session/response data live only in this tab. */
export function createSameOriginVault({
  configured = false,
  fetcher = fetch,
  sessionCsrf,
  online = () => navigator.onLine,
  onDisconnect = () => {},
}: {
  configured?: boolean;
  fetcher?: typeof fetch;
  sessionCsrf: () => Promise<string | null>;
  online?: () => boolean;
  onDisconnect?: () => void;
}) {
  let consented = false,
    generation = 0;
  const inFlight = new Set<AbortController>(),
    proposals = new Map<string, Proposal>(),
    notePayloads = new Map<string, Obj>();
  const stop = () => {
    const wasConnected = consented;
    generation++;
    consented = false;
    proposals.clear();
    notePayloads.clear();
    for (const c of inFlight) c.abort();
    inFlight.clear();
    if (wasConnected) onDisconnect();
  };
  async function wire(
    path: string,
    method = "GET",
    body?: unknown,
    external?: AbortSignal,
    allowWithoutConsent = false,
  ): Promise<{ data: unknown; confirmedAt: string }> {
    if (!configured) throw Error("REMOTE_NOT_CONFIGURED");
    if (!allowWithoutConsent && !consented) throw Error("CONSENT_NOT_GRANTED");
    if (!online()) throw Error("NETWORK");
    const n = generation,
      controller = new AbortController();
    inFlight.add(controller);
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(10000),
      ...(external ? [external] : []),
    ]);
    try {
      const headers: Record<string, string> = { accept: "application/json" };
      if (method === "POST") {
        const csrf = await sessionCsrf();
        if (!csrf) throw Error("NO_OWNER_SESSION");
        headers["x-ncore-csrf"] = csrf;
        headers["content-type"] = "application/json";
      }
      const response = await fetcher("/api/brain/v2/" + path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal,
      });
      const reader = response.body?.getReader();
      if (!reader) throw Error("INVALID_REMOTE_RESPONSE");
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const r = await reader.read();
        if (r.done) break;
        size += r.value.byteLength;
        if (size > 262144) {
          await reader.cancel();
          throw Error("INVALID_REMOTE_RESPONSE");
        }
        chunks.push(r.value);
      }
      const joined = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) {
        joined.set(c, offset);
        offset += c.byteLength;
      }
      const envelope = object(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)),
      );
      if (n !== generation || signal.aborted)
        throw Error("CONSENT_NOT_GRANTED");
      if (!response.ok) {
        if (response.status === 401 || envelope.error === "CONSENT_REQUIRED") {
          stop();
          throw Error(
            response.status === 401
              ? "NO_OWNER_SESSION"
              : "CONSENT_NOT_GRANTED",
          );
        }
        throw Error(
          typeof envelope.error === "string" &&
            /^[A-Z0-9_]{2,64}$/.test(envelope.error)
            ? envelope.error
            : "PRIVATE_CONNECTIVITY_UNAVAILABLE",
        );
      }
      if (envelope.schemaVersion !== 3) throw Error("INVALID_REMOTE_RESPONSE");
      return { data: envelope.data, confirmedAt: date(envelope.confirmedAt) };
    } finally {
      inFlight.delete(controller);
    }
  }
  const error = <T>(e: unknown): DataEnvelope<T> => {
    const code =
      e instanceof Error && /^[A-Z0-9_]{2,64}$/.test(e.message)
        ? e.message
        : "NETWORK";
    return [
      "REMOTE_NOT_CONFIGURED",
      "CONSENT_NOT_GRANTED",
      "NO_OWNER_SESSION",
    ].includes(code)
      ? {
          origin: "remote",
          state: "unavailable",
          reason: code as
            | "REMOTE_NOT_CONFIGURED"
            | "CONSENT_NOT_GRANTED"
            | "NO_OWNER_SESSION",
        }
      : {
          origin: "remote",
          state: "error",
          error: {
            code,
            message:
              code === "NETWORK"
                ? "Private connection is offline."
                : "Private request could not be confirmed.",
            retryable: true,
            at: new Date().toISOString(),
          },
        };
  };
  const wrap = async <T>(
    load: () => Promise<{ data: T; confirmedAt: string; partial?: boolean }>,
  ): Promise<DataEnvelope<T>> => {
    try {
      const n = generation,
        r = await load();
      if (n !== generation) throw Error("CONSENT_NOT_GRANTED");
      return r.partial
        ? {
            origin: "remote",
            state: "partial",
            data: r.data,
            confirmedAt: r.confirmedAt,
            missing: ["More results are available."],
          }
        : {
            origin: "remote",
            state: "ready",
            data: r.data,
            confirmedAt: r.confirmedAt,
          };
    } catch (e) {
      return error(e);
    }
  };
  const query = (q: ListQuery, search = true) => {
    if (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > 50)
      throw Error("INVALID_QUERY");
    const p = new URLSearchParams({ limit: String(q.limit) });
    if (q.cursor) p.set("cursor", q.cursor);
    if (search && q.search) p.set("q", q.search);
    return "?" + p.toString();
  };
  const port: VaultPort = configured
    ? {
        listNotes: (q, s) =>
          wrap(async () => {
            const r = await wire("notes" + query(q), "GET", undefined, s);
            return { ...page(r.data, mapNote), confirmedAt: r.confirmedAt };
          }),
        getNote: (key, s) =>
          wrap(async () => {
            id(key);
            const r = await wire("notes/" + key, "GET", undefined, s),
              n = object(r.data);
            notePayloads.set(key, n);
            const data: NoteDetail = {
              ...mapNote(n),
              body: text(n.body),
              evidence: evidence(n.evidence),
              selfReported: { state: text(object(n.selfReported).state, 40) },
            };
            return { data, confirmedAt: r.confirmedAt };
          }),
        listProposals: (q, s) =>
          wrap(async () => {
            const r = await wire(
              "proposals" + query(q, false),
              "GET",
              undefined,
              s,
            );
            const mapped = page(r.data, (value) => {
              const p = object(value),
                payload = object(p.payload),
                a = actor(p.author);
              const proposal: Proposal = {
                id: id(p.proposal_id),
                noteId: id(p.note_id),
                title: neutralizeBidi(text(payload.title, 120)),
                agent: a,
                scopes: a.scopes,
                createdAt: date(p.created_at),
                evidence: evidence(payload.evidence),
                baseRevision: integer(p.base_revision),
                intentSha256: hex(p.payload_hash),
                body: text(payload.body),
                origin: "remote",
                ...(p.state === "conflict"
                  ? { conflictsWith: [id(p.note_id)] }
                  : {}),
              };
              proposals.set(proposal.id, proposal);
              return proposal;
            });
            return { ...mapped, confirmedAt: r.confirmedAt };
          }),
        listAgents: (s) =>
          wrap(async () => {
            const r = await wire("agents", "GET", undefined, s);
            return {
              data: array(r.data, 50).map(actor),
              confirmedAt: r.confirmedAt,
            };
          }),
        graph: (q, s) =>
          wrap(async () => {
            const p = new URLSearchParams({
              depth: String(q.depth),
              limit: String(q.limit),
            });
            if (q.focus) p.set("focus", id(q.focus));
            const r = await wire("graph?" + p, "GET", undefined, s),
              g = object(r.data),
              rows = array(g.nodes, 300).map(mapNote),
              ids = new Set(rows.map((n) => n.noteId)),
              degree = new Map<string, number>();
            const edges: GraphEdge[] = array(g.edges, 900).map((v, i) => {
              const e = object(v),
                source = id(e.source_id),
                target = id(e.target_id),
                relation = text(e.relation_type, 24);
              if (
                !ids.has(source) ||
                !ids.has(target) ||
                ![
                  "related",
                  "supports",
                  "contradicts",
                  "derived-from",
                  "link",
                  "supersedes",
                ].includes(relation)
              )
                throw Error("INVALID_REMOTE_RESPONSE");
              integer(e.evidence_ordinal, 0, 31);
              degree.set(source, (degree.get(source) ?? 0) + 1);
              degree.set(target, (degree.get(target) ?? 0) + 1);
              return {
                id: source + ":" + target + ":" + i,
                source,
                target,
                relation,
                evidenceCount: 1,
                directed: true,
                origin: "remote",
              };
            });
            const nodes: GraphNode[] = rows.map((n) => ({
              id: n.noteId,
              label: n.title,
              kind: "note",
              trust: n.trust,
              flags: {},
              degree: degree.get(n.noteId) ?? 0,
              clusterId: n.type,
              revision: n.revision,
              origin: "remote",
            }));
            return {
              data: { nodes, edges },
              confirmedAt: r.confirmedAt,
              partial: boolean(g.partial),
            };
          }),
        syncStatus: (s) =>
          wrap(async () => {
            const r = await wire("status", "GET", undefined, s),
              v = object(r.data);
            let pending = 0,
              conflicts = 0,
              last: string | undefined;
            for (const x of array(v.publication, 5)) {
              const row = object(x),
                count = integer(row.count);
              if (row.state === "pending" || row.state === "failed")
                pending += count;
              if (row.state === "conflict") conflicts += count;
              if (row.state === "committed" && row.last_confirmed_at) {
                const at = date(row.last_confirmed_at);
                if (!last || at > last) last = at;
              }
            }
            const data: SyncStatusView = {
              pending,
              publishing: 0,
              conflicts,
              lastConfirmedPublicationAt: last,
              layers: [
                { layer: "gateway", ok: true, confirmedAt: r.confirmedAt },
                {
                  layer: "vault",
                  ok: Boolean(last) && pending === 0 && conflicts === 0,
                  confirmedAt: last,
                  detail: last
                    ? "Last worker acknowledgement"
                    : "No publication acknowledgement reported",
                },
                {
                  layer: "projection",
                  ok: Boolean(last) && pending === 0 && conflicts === 0,
                  confirmedAt: last,
                },
              ],
            };
            return { data, confirmedAt: r.confirmedAt };
          }),
        review: (key, decision) =>
          wrap(async () => {
            const p = proposals.get(key);
            if (!p || p.baseRevision === undefined || !p.intentSha256)
              throw Error("STALE_INTENT");
            const r = await wire("review-challenges", "POST", {
              subjectId: key,
              expectedRevision: p.baseRevision,
              decision,
              intentSha256: p.intentSha256,
            });
            const c = object(r.data);
            return {
              data: {
                id: key,
                state: "fresh-auth-required",
                challengeId: id(c.challengeId),
              },
              confirmedAt: r.confirmedAt,
            };
          }),
      }
    : unavailableVault();
  return {
    port,
    disconnect: stop,
    get consented() {
      return consented;
    },
    async connect(): Promise<boolean> {
      const n = generation,
        r = await this.capability();
      if (n === generation && r.state === "ready" && r.data.consented) {
        consented = true;
        return true;
      }
      return false;
    },
    async proposeEdit(
      noteId: string,
      body: string,
      idempotencyKey: string,
    ): Promise<DataEnvelope<ReviewReceipt>> {
      return wrap(async () => {
        const n = notePayloads.get(id(noteId));
        if (!n) throw Error("STALE_INTENT");
        const relations = array(n.relations, 32).map((v) => {
          const x = object(v);
          return {
            targetId: id(x.target_id),
            type: text(x.relation_type, 24),
            evidenceOrdinal: integer(x.evidence_ordinal, 0, 31),
            ...(x.confidence !== null && x.confidence !== undefined
              ? { confidence: x.confidence }
              : {}),
          };
        });
        const r = await wire("proposals", "POST", {
          noteId,
          baseRevision: integer(n.revision, 1),
          idempotencyKey,
          note: {
            title: text(n.title, 120),
            body: text(body),
            type: text(n.type, 16),
            tags: array(n.tags, 32),
            evidence: array(n.evidence, 32),
            relations,
          },
        });
        const p = object(r.data);
        return {
          data: { id: id(p.proposalId), state: text(p.state, 40) },
          confirmedAt: r.confirmedAt,
        };
      });
    },
    async capability(): Promise<DataEnvelope<Capability>> {
      return wrap(async () => {
        const r = await wire("capability", "GET", undefined, undefined, true),
          d = object(r.data);
        boolean(d.configured);
        boolean(d.consented);
        boolean(d.stepUpQualified);
        if (d.remoteSynchronization !== false)
          throw Error("INVALID_REMOTE_RESPONSE");
        return {
          data: {
            configured: d.configured as boolean,
            consented: d.consented as boolean,
            stepUpQualified: d.stepUpQualified as boolean,
            remoteSynchronization: false,
          },
          confirmedAt: r.confirmedAt,
        };
      });
    },
    async consent(
      granted: boolean,
    ): Promise<DataEnvelope<{ granted: boolean }>> {
      stop();
      return wrap(async () => {
        const r = await wire("consent", "POST", { granted }, undefined, true),
          d = object(r.data);
        if (d.consented !== granted) throw Error("INVALID_REMOTE_RESPONSE");
        consented = granted;
        return { data: { granted }, confirmedAt: r.confirmedAt };
      });
    },
    async start(
      challengeId: string,
    ): Promise<DataEnvelope<{ authorizationUrl: string }>> {
      return wrap(async () => {
        const r = await wire(
            "review-challenges/" + id(challengeId) + "/start",
            "POST",
            {},
          ),
          d = object(r.data),
          u = new URL(text(d.authorizationUrl, 4096));
        if (
          u.protocol !== "https:" ||
          u.hostname !== "accounts.google.com" ||
          u.username ||
          u.password
        )
          throw Error("INVALID_REMOTE_RESPONSE");
        return {
          data: { authorizationUrl: u.toString() },
          confirmedAt: r.confirmedAt,
        };
      });
    },
    async receipt(challengeId: string): Promise<DataEnvelope<ReviewReceipt>> {
      return wrap(async () => {
        const r = await wire("review-challenges/" + id(challengeId)),
          d = object(r.data);
        return {
          data: {
            id: challengeId,
            state: text(d.state, 40),
            challengeId,
            decision: text(d.decision, 30),
            subjectId: id(d.subjectId),
            expectedRevision: integer(d.expectedRevision),
            intentSha256: hex(d.intentSha256),
            ...(d.preview
              ? {
                  preview: {
                    title: text(object(d.preview).title, 120),
                    body: text(object(d.preview).body),
                  },
                }
              : {}),
          },
          confirmedAt: r.confirmedAt,
        };
      });
    },
    async complete(challengeId: string): Promise<DataEnvelope<ReviewReceipt>> {
      return wrap(async () => {
        const r = await wire(
            "review-challenges/" + id(challengeId) + "/complete",
            "POST",
            {},
          ),
          d = object(r.data);
        return {
          data: {
            id:
              typeof d.proposalId === "string" ? id(d.proposalId) : challengeId,
            state: text(d.state, 40),
            ...(d.noteId ? { noteId: id(d.noteId) } : {}),
            ...(d.revision !== undefined
              ? { revision: integer(d.revision, 1) }
              : {}),
          },
          confirmedAt: r.confirmedAt,
        };
      });
    },
  };
}
