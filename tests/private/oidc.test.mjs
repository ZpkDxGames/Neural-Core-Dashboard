import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createGoogleProvider } from "../../lib/auth/owner-runtime.ts";
import { config, origin } from "../helpers/owner-fixture.mjs";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 }),
  jwk = {
    ...pair.publicKey.export({ format: "jwk" }),
    kid: "synthetic-stepup",
    alg: "RS256",
    use: "sig",
  },
  input = {
    state: "synthetic-state",
    nonce: "synthetic-nonce",
    verifier: "x".repeat(43),
    redirectUri: origin + "/api/brain/v2/step-up/callback",
    currentUrl:
      origin +
      "/api/brain/v2/step-up/callback?state=synthetic-state&code=synthetic-code",
  };
function setup(override = {}) {
  return createGoogleProvider(
    config,
    async (url) => {
      if (String(url).includes("/.well-known/"))
        return Response.json({
          issuer: "https://accounts.google.com",
          authorization_endpoint:
            "https://accounts.google.com/o/oauth2/v2/auth",
          token_endpoint: "https://oauth2.googleapis.com/token",
          jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: [
            "client_secret_post",
            "client_secret_basic",
          ],
        });
      if (String(url).includes("/certs")) return Response.json({ keys: [jwk] });
      const now = Math.floor(Date.now() / 1000),
        h = Buffer.from(
          JSON.stringify({ alg: "RS256", kid: jwk.kid }),
        ).toString("base64url"),
        p = Buffer.from(
          JSON.stringify({
            iss: "https://accounts.google.com",
            aud: config.clientId,
            sub: config.ownerSub,
            nonce: input.nonce,
            iat: now,
            exp: now + 300,
            email_verified: true,
            auth_time: now,
            ...override,
          }),
        ).toString("base64url");
      return Response.json({
        access_token: "synthetic-only",
        token_type: "Bearer",
        expires_in: 300,
        id_token:
          h +
          "." +
          p +
          "." +
          sign(
            "RSA-SHA256",
            Buffer.from(h + "." + p),
            pair.privateKey,
          ).toString("base64url"),
      });
    },
    true,
  );
}
test("step-up uses pinned signed Google protocol with PKCE/nonce/state and requests max_age=0", async () => {
  const provider = setup(),
    url = new URL(await provider.authorize(input));
  assert.equal(url.searchParams.get("max_age"), "0");
  assert.equal(url.searchParams.get("prompt"), "select_account");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const claims = await provider.exchange(input);
  assert.equal(claims.sub, config.ownerSub);
  assert.equal(Number.isSafeInteger(claims.auth_time), true);
});
for (const [name, claims] of [
  ["missing freshness", { auth_time: undefined }],
  ["stale freshness", { auth_time: Math.floor(Date.now() / 1000) - 1000 }],
  ["wrong nonce", { nonce: "wrong" }],
  ["wrong audience", { aud: "other.apps.googleusercontent.com" }],
])
  test("signed step-up rejects " + name, async () => {
    await assert.rejects(
      () => setup(claims).exchange(input),
      (e) => e.code === "GOOGLE_EXCHANGE_REJECTED",
    );
  });
