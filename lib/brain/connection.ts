// lib/brain/connection.ts — pure, deterministic. First matching rule wins (ROUTE_PARITY §1.5).
import type { ConnectionInput, ReasonCode } from "./types.ts";
import type { StatusKey } from "./status.ts";

export interface ConnectionResult {
  status: StatusKey;
  reason?: ReasonCode;
  count?: number;
  code?: string;
}

export function deriveConnectionState(i: ConnectionInput): ConnectionResult {
  // 1. No remote capability or no approval => local only (this is the ONLY reachable result in the current build).
  if (!i.remoteConfigured)
    return { status: "sync.local-only", reason: "REMOTE_NOT_CONFIGURED" };
  if (!i.ownerAuthEnabled)
    return { status: "sync.local-only", reason: "OWNER_AUTH_DISABLED" };
  if (!i.consentGranted)
    return { status: "sync.local-only", reason: "CONSENT_NOT_GRANTED" };
  if (i.remote?.state === "unavailable")
    return { status: "sync.local-only", reason: i.remote.reason };
  // 2. Session
  if (i.session === "loading") return { status: "session.loading" };
  if (i.session === "error")
    return { status: "sync.failed", code: "SESSION_ERROR" };
  if (i.session !== "signed-in")
    return { status: "sync.signed-out", reason: "NO_OWNER_SESSION" };
  // 3. Failed (non-network)
  if (i.remote?.state === "error" && i.remote.error.code !== "NETWORK")
    return { status: "sync.failed", code: i.remote.error.code };
  // 4. Disconnected
  if (
    !i.online ||
    (i.remote?.state === "error" && i.remote.error.code === "NETWORK")
  )
    return { status: "sync.disconnected", reason: "NETWORK" };
  // 5. Stale (never confirmed counts as stale)
  const confirmed =
    i.remote && "confirmedAt" in i.remote && i.remote.confirmedAt
      ? Date.parse(i.remote.confirmedAt)
      : NaN;
  if (!Number.isFinite(confirmed) || i.now - confirmed > i.staleAfterMs)
    return { status: "sync.stale", reason: "STALE" };
  const data =
    i.remote && (i.remote.state === "ready" || i.remote.state === "partial")
      ? i.remote.data
      : undefined;
  // 6. Conflict
  if (data && data.conflicts > 0)
    return { status: "sync.conflict", count: data.conflicts };
  // 7. Pending
  const pending =
    (data?.pending ?? 0) + (data?.publishing ?? 0) + i.localQueuedWrites;
  if (pending > 0) return { status: "sync.pending", count: pending };
  // 8. Ready
  return { status: "sync.remote-ready" };
}
