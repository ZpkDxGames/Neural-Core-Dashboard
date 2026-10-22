import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createSameOriginVault,
  mapNote,
} from "../../lib/brain/private/adapter.ts";
const noteId = randomUUID(),
  principal = randomUUID(),
  signal = () => new AbortController().signal,
  confirmedAt = new Date().toISOString();
const summary = {
  noteId,
  title: "SYNTH note",
  type: "reference",
  revision: 1,
  tags: ["synthetic"],
  trust: "verified",
  verifiedBy: principal,
  verifiedAt: confirmedAt,
  updatedAt: confirmedAt,
  pending: false,
};
const actor = {
  principal_id: principal,
  display_name: "SYNTH owner",
  kind: "owner",
  role: "owner",
  scopes: ["read", "review"],
};
function fixture() {
  const calls = [];
  let consented = false,
    answer = null,
    offline = false;
  const fetcher = async (path, init) => {
    calls.push({ path, init });
    let data;
    if (path.endsWith("/consent")) {
      consented = JSON.parse(init.body).granted;
      data = { consented, consentEpoch: 1 };
    } else if (path.endsWith("/capability"))
      data = {
        configured: true,
        consented,
        stepUpQualified: false,
        remoteSynchronization: false,
      };
    else if (answer) {
      const v = await answer(path, init);
      return v;
    } else data = { items: [summary], partial: false, nextCursor: null };
    return Response.json({ schemaVersion: 3, confirmedAt, data });
  };
  const adapter = createSameOriginVault({
    configured: true,
    fetcher,
    sessionCsrf: async () => "synthetic-csrf",
    online: () => !offline,
  });
  return {
    adapter,
    calls,
    setAnswer: (fn) => (answer = fn),
    setOffline: (v) => (offline = v),
  };
}
test("browser adapter makes no network request before configuration and explicit session consent", async () => {
  let calls = 0;
  const a = createSameOriginVault({
    fetcher: async () => {
      calls++;
      throw Error();
    },
    sessionCsrf: async () => null,
    online: () => true,
  });
  assert.equal(
    (await a.port.listNotes({ limit: 25 }, signal())).state,
    "unavailable",
  );
  assert.equal(calls, 0);
  const f = fixture();
  assert.equal(
    (await f.adapter.port.listNotes({ limit: 25 }, signal())).state,
    "unavailable",
  );
  assert.equal(f.calls.length, 0);
  await f.adapter.consent(true);
  const r = await f.adapter.port.listNotes({ limit: 25 }, signal());
  assert.equal(r.state, "ready");
  assert.equal(r.data.items[0].origin, "remote");
  assert.equal(r.data.total, undefined);
  assert.equal(
    f.calls.every((x) => x.path.startsWith("/api/brain/v2/")),
    true,
  );
  assert.equal(f.calls[0].init.credentials, "same-origin");
  assert.equal(f.calls[0].init.headers["x-ncore-csrf"], "synthetic-csrf");
  assert.equal(
    f.calls.some((x) => x.init.headers.authorization),
    false,
  );
});
test("defensive mapping preserves cursor/partial/owner identity and evidence remains unresolved", async () => {
  const f = fixture();
  await f.adapter.consent(true);
  f.setAnswer(async () =>
    Response.json({
      schemaVersion: 3,
      confirmedAt,
      data: {
        items: [
          {
            proposal_id: randomUUID(),
            note_id: noteId,
            principal_id: principal,
            author: actor,
            base_revision: 0,
            payload_hash: "a".repeat(64),
            payload: {
              title: "SYNTH proposal",
              body: "inert",
              evidence: [
                {
                  kind: "conversation",
                  conversationId: "synthetic-source",
                  messageId: "m1",
                },
              ],
            },
            state: "proposed",
            created_at: confirmedAt,
          },
        ],
        partial: true,
        nextCursor: "opaque-signed-cursor",
      },
    }),
  );
  const r = await f.adapter.port.listProposals({ limit: 1 }, signal());
  assert.equal(r.state, "partial");
  assert.equal(r.data.nextCursor, "opaque-signed-cursor");
  assert.equal(r.data.items[0].agent.kind, "owner");
  assert.equal(r.data.items[0].agent.role, "owner");
  assert.equal(r.data.items[0].evidence[0].resolvable, false);
  assert.equal(r.data.items[0].evidence[0].consent, "unknown");
});
test("unconfirmed/malformed, failed, offline and over-budget responses cannot render as success", async () => {
  const f = fixture();
  await f.adapter.consent(true);
  for (const response of [
    () => Response.json({ schemaVersion: 3, data: { items: [] } }),
    () =>
      Response.json({
        schemaVersion: 3,
        confirmedAt,
        data: {
          items: [{ ...summary, revision: 0 }],
          partial: false,
          nextCursor: null,
        },
      }),
    () =>
      Response.json({ error: "PRIVATE_SERVICE_UNAVAILABLE" }, { status: 503 }),
    () =>
      Response.json({
        schemaVersion: 3,
        confirmedAt,
        data: { items: [], partial: true, nextCursor: null },
      }),
    () => new Response("x".repeat(262145)),
  ]) {
    f.setAnswer(async () => response());
    assert.equal(
      (await f.adapter.port.listNotes({ limit: 25 }, signal())).state,
      "error",
    );
  }
  f.setOffline(true);
  const r = await f.adapter.port.listNotes({ limit: 25 }, signal());
  assert.equal(r.state, "error");
  assert.equal(r.error.code, "NETWORK");
  assert.throws(() => mapNote({ ...summary, verifiedBy: undefined }));
});
test("consent revocation/disconnect abort requests and suppress late responses without persisting cache", async () => {
  const f = fixture();
  await f.adapter.consent(true);
  let respond;
  const pending = new Promise((r) => (respond = r));
  f.setAnswer(async () => {
    await pending;
    return Response.json({
      schemaVersion: 3,
      confirmedAt,
      data: { items: [summary], partial: false, nextCursor: null },
    });
  });
  const request = f.adapter.port.listNotes({ limit: 25 }, signal());
  await Promise.resolve();
  f.adapter.disconnect();
  respond();
  const r = await request;
  assert.equal(r.state, "unavailable");
  assert.equal(f.adapter.consented, false);
  assert.equal(
    (await f.adapter.port.listNotes({ limit: 25 }, signal())).state,
    "unavailable",
  );
});
test("session revocation clears tab authority and uncertain review remains pending until engine acknowledgement", async () => {
  const f = fixture();
  await f.adapter.consent(true);
  f.setAnswer(async () =>
    Response.json({ error: "NO_OWNER_SESSION" }, { status: 401 }),
  );
  assert.equal(
    (await f.adapter.port.syncStatus(signal())).state,
    "unavailable",
  );
  assert.equal(f.adapter.consented, false);
  await f.adapter.consent(true);
  f.setAnswer(async () =>
    Response.json({
      schemaVersion: 3,
      confirmedAt,
      data: { proposalId: randomUUID(), noteId, revision: 2, state: "pending" },
    }),
  );
  const r = await f.adapter.complete(randomUUID());
  assert.equal(r.state, "ready");
  assert.equal(r.data.state, "pending");
});
