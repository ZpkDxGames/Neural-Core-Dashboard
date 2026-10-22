import test from "node:test";
import assert from "node:assert/strict";
import { ownerController } from "../../lib/auth/owner-core.ts";
import { ownerAccess } from "../../lib/auth/owner-access.ts";
import {
  config,
  origin,
  memoryStore,
  provider,
  login,
  request,
} from "../helpers/owner-fixture.mjs";
async function fixture() {
  let now = Date.now();
  const store = memoryStore(() => now),
    controller = ownerController({ config, store, provider, clock: () => now }),
    signed = await login(controller),
    access = ownerAccess(config, store, () => now),
    req = (method = "GET", headers = {}) =>
      new Request(origin + "/api/brain/v2/status", {
        method,
        headers: { cookie: signed.cookie, ...headers },
      });
  return { store, controller, signed, access, req, advance: (n) => (now += n) };
}
test("private owner access reuses primary owner session/family, exact origin and CSRF", async () => {
  const f = await fixture(),
    a = await f.access.read(f.req());
  assert.match(a.sessionRef, /^[a-f0-9]{64}$/);
  assert.match(a.identityHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(await f.access.verifyFamily(a), { expiresAt: a.expiresAt });
  await assert.rejects(() => f.access.read(f.req("POST"), true), /CSRF_DENIED/);
  await f.access.read(
    f.req("POST", { origin, "x-ncore-csrf": f.signed.body.csrf }),
    true,
  );
  for (const headers of [
    { origin: "https://attacker.invalid" },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
  ])
    await assert.rejects(
      () => f.access.read(f.req("GET", headers)),
      /CSRF_DENIED/,
    );
  const logout = await f.controller.logout(
    request("logout", "POST", {
      cookie: f.signed.cookie,
      origin,
      "x-ncore-csrf": f.signed.body.csrf,
    }),
  );
  assert.equal(logout.status, 200);
  await assert.rejects(() => f.access.read(f.req()), /NO_OWNER_SESSION/);
  assert.equal(await f.access.verifyFamily(a), null);
});
test("fresh owner decisions require same allowlisted signed subject and auth_time, never token iat", async () => {
  const f = await fixture(),
    a = await f.access.read(f.req()),
    now = Math.floor(Date.now() / 1000);
  for (const value of [
    { sub: config.ownerSub, email_verified: true, iat: now },
    { sub: "99999999", email_verified: true, auth_time: now },
    { sub: config.ownerSub, email_verified: false, auth_time: now },
    { sub: config.ownerSub, email_verified: true, auth_time: now - 121 },
    { sub: config.ownerSub, email_verified: true, auth_time: now + 6 },
  ])
    assert.throws(() => f.access.fresh(value, a), /STEP_UP_UNAVAILABLE/);
  assert.equal(
    f.access.fresh(
      { sub: config.ownerSub, email_verified: true, auth_time: now },
      a,
    ),
    now,
  );
  f.advance(8 * 3600 * 1000 + 1);
  await assert.rejects(() => f.access.read(f.req()), /NO_OWNER_SESSION/);
});
test("owner session-store outages fail closed with no cached access", async () => {
  const f = await fixture();
  await f.access.read(f.req());
  f.store.get = async () => {
    throw Error("SYNTHETIC_STORAGE_OUTAGE");
  };
  await assert.rejects(() => f.access.read(f.req()), /OUTAGE/);
});
