import test from "node:test";
import assert from "node:assert/strict";
import { ownerController } from "../../lib/auth/owner-core.ts";
import { ownerAccess } from "../../lib/auth/owner-access.ts";
import {
  privateRevocationRequired,
  revokeSessionWith,
} from "../../lib/brain/private/connection.ts";
import {
  config,
  origin,
  memoryStore,
  provider,
  login,
  request,
  begin,
  finish,
  cookie,
} from "../helpers/owner-fixture.mjs";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const logoutRequest = (signed) =>
  request("logout", "POST", {
    cookie: signed.cookie,
    origin,
    "x-ncore-csrf": signed.body.csrf,
  });

test("coordinated logout waits for the SQL fence; a concurrent token rotation cannot escape family retirement", async () => {
  const store = memoryStore(),
    entered = deferred(),
    gate = deferred(),
    received = [];
  const controller = ownerController({
    config,
    store,
    provider,
    revokeOwnerSession: async (value) => {
      received.push(value);
      entered.resolve();
      await gate.promise;
    },
  });
  const signed = await login(controller),
    access = ownerAccess(config, store),
    before = await access.read(
      request("session", "GET", { cookie: signed.cookie }),
    );
  let finished = false;
  const pending = controller.logout(logoutRequest(signed)).then((r) => {
    finished = true;
    return r;
  });
  await entered.promise;
  assert.equal(finished, false);
  assert.deepEqual(await access.verifyFamily(before), {
    expiresAt: before.expiresAt,
  });
  const rotated = await controller.rotate(
    request("rotate", "POST", {
      cookie: signed.cookie,
      origin,
      "x-ncore-csrf": signed.body.csrf,
    }),
  );
  assert.equal(rotated.status, 200);
  gate.resolve();
  assert.equal((await pending).status, 200);
  assert.deepEqual(received, [
    {
      sessionRef: before.sessionRef,
      identityHash: before.identityHash,
      expiresAt: before.expiresAt,
    },
  ]);
  assert.equal(await access.verifyFamily(before), null);
  assert.equal(
    (
      await controller.session(
        request("session", "GET", {
          cookie: cookie(rotated, "__Host-nc-owner"),
        }),
      )
    ).status,
    401,
  );
});
test("SQL revocation failure is a sanitized 503, keeps a retryable family and never bypasses CSRF/origin", async () => {
  const store = memoryStore(),
    events = [];
  let failed = true,
    calls = 0;
  const controller = ownerController({
    config,
    store,
    provider,
    report: (code) => events.push(code),
    revokeOwnerSession: async () => {
      calls++;
      if (failed) throw Error("SYNTH private credentials must never be logged");
    },
  });
  const signed = await login(controller);
  for (const headers of [
    { origin, "x-ncore-csrf": "bad" },
    { origin: "https://attacker.invalid", "x-ncore-csrf": signed.body.csrf },
  ])
    assert.equal(
      (
        await controller.logout(
          request("logout", "POST", { cookie: signed.cookie, ...headers }),
        )
      ).status,
      403,
    );
  assert.equal(calls, 0);
  const denied = await controller.logout(logoutRequest(signed));
  assert.equal(denied.status, 503);
  assert.deepEqual(await denied.json(), {
    error: "AUTH_UNAVAILABLE",
    reason: "revocation",
  });
  assert.deepEqual(events, ["AUTH_REVOCATION_UNAVAILABLE"]);
  assert.equal(
    (
      await controller.session(
        request("session", "GET", { cookie: signed.cookie }),
      )
    ).status,
    200,
  );
  failed = false;
  assert.equal((await controller.logout(logoutRequest(signed))).status, 200);
  assert.equal(calls, 2);
});
test("Redis deletion failure after a committed SQL fence retries the same family without reviving SQL authority", async () => {
  const store = memoryStore(),
    fences = new Set(),
    calls = [];
  const controller = ownerController({
    config,
    store,
    provider,
    revokeOwnerSession: async (a) => {
      fences.add(a.sessionRef);
      calls.push(a);
    },
  });
  const signed = await login(controller),
    remove = store.remove;
  store.remove = async () => {
    throw Error("SYNTH Redis unavailable");
  };
  assert.equal((await controller.logout(logoutRequest(signed))).status, 503);
  assert.equal(fences.size, 1);
  store.remove = remove;
  assert.equal((await controller.logout(logoutRequest(signed))).status, 200);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(fences.size, 1);
});
test("login replacement fences the old family before issuing a new cookie and reports an uncertain fence as unavailable", async () => {
  const store = memoryStore(),
    values = [];
  let fail = true;
  const controller = ownerController({
    config,
    store,
    provider,
    revokeOwnerSession: async (a) => {
      values.push(a);
      if (fail) throw Error("SYNTH lost acknowledgment");
    },
  });
  const signed = await login(controller),
    old = await ownerAccess(config, store).read(
      request("session", "GET", { cookie: signed.cookie }),
    );
  const rejected = await finish(controller, await begin(controller), {
    cookie: signed.cookie + "; " + (await begin(controller)).binding,
  });
  // The correct one-use binding is tested below; an unrelated flow cannot revoke anything.
  assert.match(rejected.headers.get("location"), /auth=failed/);
  assert.equal(values.length, 0);
  const flow = await begin(controller);
  const unavailable = await finish(controller, flow, {
    cookie: signed.cookie + "; " + flow.binding,
  });
  assert.match(unavailable.headers.get("location"), /auth=unavailable/);
  assert.equal(cookie(unavailable, "__Host-nc-owner"), "");
  assert.equal(
    (
      await controller.session(
        request("session", "GET", { cookie: signed.cookie }),
      )
    ).status,
    200,
  );
  fail = false;
  const nextFlow = await begin(controller),
    replaced = await finish(controller, nextFlow, {
      cookie: signed.cookie + "; " + nextFlow.binding,
    });
  assert.match(replaced.headers.get("location"), /auth=signed-in/);
  assert.equal(
    (
      await controller.session(
        request("session", "GET", { cookie: signed.cookie }),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await controller.session(
        request("session", "GET", {
          cookie: cookie(replaced, "__Host-nc-owner"),
        }),
      )
    ).status,
    200,
  );
  assert.equal(values[0].sessionRef, old.sessionRef);
  assert.deepEqual(values[0], values[1]);
});
test("family retirement requires a bound positive gateway acknowledgment; authentication and outage responses are never success", async () => {
  const session = {
    sessionRef: "a".repeat(64),
    identityHash: "b".repeat(64),
    expiresAt: Date.now() + 3600000,
  };
  const identity = {
    principalId: "12345678-1234-4234-8234-123456789012",
    ownerId: "synthetic-owner",
  };
  const valid = {
    status: 200,
    body: {
      schemaVersion: 3,
      confirmedAt: new Date().toISOString(),
      data: { revoked: true, sessionRef: session.sessionRef },
    },
  };
  const calls = [],
    transport = {
      close() {},
      async call(...args) {
        calls.push(args);
        return valid;
      },
    };
  await revokeSessionWith(transport, identity, session);
  assert.equal(calls[0][1], "POST");
  assert.equal(calls[0][2], "/v2/private/session/revoke");
  assert.deepEqual(calls[0][3], {});
  assert.equal(calls[0][0].sessionRef, session.sessionRef);
  assert.equal(calls[0][0].principalEpoch, 0);
  assert.equal(calls[0][0].consentEpoch, 0);
  assert.ok(calls[0][4] instanceof AbortSignal);
  for (const response of [
    { status: 401, body: { error: "NO_OWNER_SESSION" } },
    { status: 503, body: { error: "PRIVATE_SERVICE_UNAVAILABLE" } },
    { status: 200, body: { ...valid.body, data: null } },
    {
      status: 200,
      body: {
        ...valid.body,
        data: { revoked: true, sessionRef: "c".repeat(64) },
      },
    },
    {
      status: 200,
      body: {
        ...valid.body,
        data: { revoked: false, sessionRef: session.sessionRef },
      },
    },
    { status: 200, body: { ...valid.body, confirmedAt: "invalid" } },
  ])
    await assert.rejects(
      () =>
        revokeSessionWith(
          { ...transport, call: async () => response },
          identity,
          session,
        ),
      /PRIVATE_REVOCATION_UNCONFIRMED/,
    );
});
test("turning off private capability flags cannot bypass retirement when private connection configuration remains", () => {
  assert.equal(privateRevocationRequired({}), false);
  assert.equal(
    privateRevocationRequired({
      NCORE_BRAIN_PRIVATE_ENABLED: "0",
      NCORE_PRIVATE_STAGING_CERTIFIED: "0",
    }),
    false,
  );
  for (const env of [
    { NCORE_BRAIN_PRIVATE_ENABLED: "1" },
    { NCORE_PRIVATE_STAGING_CERTIFIED: "1" },
    { NCORE_PRIVATE_GATEWAY_ORIGIN: "https://synthetic.invalid" },
    { NCORE_PRIVATE_CLIENT_KEY_FILE: "/synthetic.key" },
    { NCORE_PRIVATE_OWNER_PRINCIPAL: "synthetic" },
  ])
    assert.equal(
      privateRevocationRequired({
        ...env,
        NCORE_GOOGLE_FRESH_AUTH_QUALIFIED: "0",
      }),
      true,
    );
});
