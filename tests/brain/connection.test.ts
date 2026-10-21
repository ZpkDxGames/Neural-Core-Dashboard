import test from "node:test";
import assert from "node:assert/strict";
import { deriveConnectionState } from "../../lib/brain/connection.ts";
import { ready, unavailable } from "../../lib/brain/envelope.ts";
import type { ConnectionInput, SyncStatusView } from "../../lib/brain/types.ts";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const view = (o: Partial<SyncStatusView> = {}): SyncStatusView => ({
  pending: 0,
  publishing: 0,
  conflicts: 0,
  layers: [],
  ...o,
});
const base = (o: Partial<ConnectionInput> = {}): ConnectionInput => ({
  remoteConfigured: true,
  ownerAuthEnabled: true,
  consentGranted: true,
  session: "signed-in",
  online: true,
  remote: ready(view(), "remote", "2026-10-19T11:59:30Z"),
  localQueuedWrites: 0,
  now: NOW,
  staleAfterMs: 90_000,
  ...o,
});

test("CURRENT BUILD: remote not configured is always local-only", () => {
  const r = deriveConnectionState(
    base({
      remoteConfigured: false,
      session: "signed-in",
      consentGranted: true,
    }),
  );
  assert.deepEqual(r, {
    status: "sync.local-only",
    reason: "REMOTE_NOT_CONFIGURED",
  });
});
test("owner auth disabled and consent missing are local-only with distinct reasons", () => {
  assert.equal(
    deriveConnectionState(base({ ownerAuthEnabled: false })).reason,
    "OWNER_AUTH_DISABLED",
  );
  assert.equal(
    deriveConnectionState(base({ consentGranted: false })).reason,
    "CONSENT_NOT_GRANTED",
  );
});
test("signing in does not imply sync", () => {
  const r = deriveConnectionState(
    base({ remoteConfigured: false, session: "signed-in" }),
  );
  assert.equal(r.status, "sync.local-only");
});
test("session states", () => {
  assert.equal(
    deriveConnectionState(base({ session: "loading" })).status,
    "session.loading",
  );
  assert.equal(
    deriveConnectionState(base({ session: "signed-out" })).status,
    "sync.signed-out",
  );
  assert.equal(
    deriveConnectionState(base({ session: "error" })).status,
    "sync.failed",
  );
});
test("failed vs disconnected", () => {
  const err = (code: string) =>
    ({
      origin: "remote",
      state: "error",
      error: { code, message: "", retryable: true, at: "" },
    }) as const;
  assert.equal(
    deriveConnectionState(base({ remote: err("GATEWAY_DOWN") })).status,
    "sync.failed",
  );
  assert.equal(
    deriveConnectionState(base({ remote: err("NETWORK") })).status,
    "sync.disconnected",
  );
  assert.equal(
    deriveConnectionState(base({ online: false })).status,
    "sync.disconnected",
  );
});
test("never-confirmed and old confirmations are stale, not ready", () => {
  assert.equal(
    deriveConnectionState(base({ remote: null })).status,
    "sync.stale",
  );
  assert.equal(
    deriveConnectionState(
      base({ remote: ready(view(), "remote", "2026-10-19T11:57:00Z") }),
    ).status,
    "sync.stale",
  );
});
test("precedence: stale > conflict > pending > ready", () => {
  const fresh = "2026-10-19T11:59:50Z";
  assert.equal(
    deriveConnectionState(
      base({
        remote: ready(view({ conflicts: 2, pending: 5 }), "remote", fresh),
      }),
    ).status,
    "sync.conflict",
  );
  assert.deepEqual(
    deriveConnectionState(
      base({
        remote: ready(view({ pending: 2, publishing: 1 }), "remote", fresh),
        localQueuedWrites: 1,
      }),
    ),
    { status: "sync.pending", count: 4 },
  );
  assert.equal(
    deriveConnectionState(
      base({
        remote: ready(view({ conflicts: 1 }), "remote", "2026-10-19T11:00:00Z"),
      }),
    ).status,
    "sync.stale",
  );
  assert.equal(deriveConnectionState(base()).status, "sync.remote-ready");
});
test("backend-unavailable envelope degrades to local-only with its reason", () => {
  assert.deepEqual(
    deriveConnectionState(base({ remote: unavailable("NOT_IMPLEMENTED") })),
    { status: "sync.local-only", reason: "NOT_IMPLEMENTED" },
  );
});
