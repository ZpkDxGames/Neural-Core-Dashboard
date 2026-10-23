import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPrivateBff } from "../../lib/brain/private/bff.ts";
import { ownerAccess } from "../../lib/auth/owner-access.ts";
import { ownerController } from "../../lib/auth/owner-core.ts";
import {
  config,
  origin,
  memoryStore,
  provider,
  login,
  cookie,
} from "../helpers/owner-fixture.mjs";
async function fixture(qualified = true) {
  const store = memoryStore(),
    ctrl = ownerController({ config, store, provider }),
    signed = await login(ctrl),
    access = ownerAccess(config, store),
    principalId = randomUUID(),
    challengeId = randomUUID(),
    calls = [];
  let granted = false,
    state = "fresh-auth-required";
  const transport = {
    close() {},
    async call(context, method, target, body) {
      calls.push({ context, method, target, body });
      let data;
      if (target === "/v2/private/session")
        data = {
          ...context,
          principalEpoch: 1,
          consentEpoch: 1,
          consented: granted,
        };
      else if (target === "/v2/private/consent") {
        granted = body.granted;
        data = { consented: granted, consentEpoch: 1 };
      } else if (target.endsWith("/fresh")) {
        state = "confirmation-required";
        data = { state };
      } else if (target.endsWith("/complete"))
        data = { state: "pending", proposalId: randomUUID(), revision: 1 };
      else if (target.includes("/review-challenges/"))
        data = { challengeId, state };
      else if (target === "/v2/private/review-challenges")
        data = { challengeId, state };
      else data = { items: [], partial: false, nextCursor: null };
      return {
        status: 200,
        body: { schemaVersion: 3, confirmedAt: new Date().toISOString(), data },
      };
    },
  };
  const stepProvider = {
    async authorize(input) {
      return provider.authorize(input);
    },
    async exchange() {
      return {
        sub: config.ownerSub,
        email_verified: true,
        auth_time: Math.floor(Date.now() / 1000),
      };
    },
  };
  const bff = createPrivateBff({
    access,
    transport,
    identity: { principalId, ownerId: "synthetic-owner" },
    store,
    provider: stepProvider,
    stepUpQualified: qualified,
    origin,
  });
  const req = (path, method = "GET", body, headers = {}) =>
    new Request(origin + "/api/brain/v2/" + path, {
      method,
      headers: {
        cookie: signed.cookie,
        ...(method === "POST"
          ? {
              origin,
              "x-ncore-csrf": signed.body.csrf,
              "content-type": "application/json",
            }
          : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    bff,
    req,
    calls,
    transport,
    stepProvider,
    store,
    challengeId,
    signed,
    ctrl,
  };
}
test("BFF same-origin owner consent, CSRF and browser credential isolation", async () => {
  const f = await fixture();
  assert.equal((await f.bff(f.req("notes"))).status, 403);
  assert.equal(
    (
      await f.bff(
        f.req("consent", "POST", { granted: true }, { "x-ncore-csrf": "bad" }),
      )
    ).status,
    403,
  );
  assert.equal(
    (await f.bff(f.req("consent", "POST", { granted: true }))).status,
    200,
  );
  const r = await f.bff(f.req("notes"));
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control"), /no-store/);
  assert.equal(r.headers.get("vary"), "Cookie");
  assert.equal(r.headers.has("access-control-allow-origin"), false);
  assert.equal(
    (
      await f.bff(
        f.req("notes", "GET", undefined, { "sec-fetch-site": "cross-site" }),
      )
    ).status,
    403,
  );
  assert.equal((await f.bff(f.req("private-arbitrary-proxy"))).status, 404);
  assert.equal(
    (await f.bff(f.req("consent", "POST", { granted: true, owner: "forged" })))
      .status,
    400,
  );
  assert.equal(
    f.calls.some((x) => x.context.ownerId === "forged"),
    false,
  );
});
test("BFF Google step-up binds session, single-use state/browser cookie, nonce and exact challenge", async () => {
  const f = await fixture();
  await f.bff(f.req("consent", "POST", { granted: true }));
  const start = await f.bff(
    f.req("review-challenges/" + f.challengeId + "/start", "POST", {}),
  );
  assert.equal(start.status, 200);
  const result = await start.json(),
    state = new URL(result.data.authorizationUrl).searchParams.get("state"),
    binding = cookie(start, "__Host-nc-memory-stepup");
  const callback = f.req(
    "step-up/callback?state=" + state + "&code=synthetic-code",
    "GET",
    undefined,
    { cookie: f.signed.cookie + "; " + binding },
  );
  const done = await f.bff(callback);
  assert.equal(done.status, 303);
  assert.equal(
    done.headers.get("location"),
    origin + "/agents?review=" + f.challengeId,
  );
  const replay = await f.bff(callback);
  assert.match(replay.headers.get("location"), /step-up-unavailable/);
  const post = f.calls.find((x) => x.target.endsWith("/fresh"));
  assert.equal(post.body.identityHash, post.context.identityHash);
  assert.equal(Number.isSafeInteger(post.body.authTime), true);
});
test("BFF fails closed when freshness is unqualified, missing, mismatched or provider fails", async () => {
  const unavailable = await fixture(false);
  await unavailable.bff(unavailable.req("consent", "POST", { granted: true }));
  assert.equal(
    (
      await unavailable.bff(
        unavailable.req(
          "review-challenges/" + unavailable.challengeId + "/start",
          "POST",
          {},
        ),
      )
    ).status,
    403,
  );
  for (const claims of [
    { sub: config.ownerSub, email_verified: true },
    {
      sub: "other",
      email_verified: true,
      auth_time: Math.floor(Date.now() / 1000),
    },
  ]) {
    const f = await fixture();
    await f.bff(f.req("consent", "POST", { granted: true }));
    f.stepProvider.exchange = async () => claims;
    const start = await f.bff(
        f.req("review-challenges/" + f.challengeId + "/start", "POST", {}),
      ),
      data = await start.json(),
      state = new URL(data.data.authorizationUrl).searchParams.get("state"),
      binding = cookie(start, "__Host-nc-memory-stepup");
    assert.equal(
      (
        await f.bff(
          f.req(
            "step-up/callback?state=" + state + "&code=synthetic",
            "GET",
            undefined,
            { cookie: f.signed.cookie + "; " + binding },
          ),
        )
      ).status,
      403,
    );
    assert.equal(
      f.calls.some((x) => x.target.endsWith("/fresh")),
      false,
    );
  }
});
test("BFF outages and malformed responses never become an empty successful collection", async () => {
  const f = await fixture();
  await f.bff(f.req("consent", "POST", { granted: true }));
  const saved = f.transport.call;
  f.transport.call = async () => {
    throw Error("private credential and raw source details");
  };
  const r = await f.bff(f.req("notes"));
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), {
    error: "PRIVATE_CONNECTIVITY_UNAVAILABLE",
  });
  f.transport.call = async (...args) =>
    args[2] === "/v2/private/session"
      ? saved(...args)
      : { status: 200, body: { data: [] } };
  assert.equal((await f.bff(f.req("notes"))).status, 503);
});
