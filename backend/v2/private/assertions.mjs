import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  randomBytes,
} from "node:crypto";
import { fail, hash, uuid } from "../note.mjs";
import { strictJSON } from "./validation.mjs";
export const ISSUER = "neural-brain-owner-bff-staging",
  AUDIENCE = "neural-brain-private-gateway-staging";
const hex = (x) => typeof x === "string" && /^[0-9a-f]{64}$/.test(x);
const integer = (x) => Number.isSafeInteger(x) && x >= 0;
const record = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
/** The actual raw request target is required; URL normalization must not hide dot segments. */
export function canonicalTarget(raw) {
  if (
    typeof raw !== "string" ||
    raw.length > 4096 ||
    !raw.startsWith("/") ||
    raw.includes("#") ||
    raw.includes("\\") ||
    /[^\x21-\x7e]/.test(raw)
  )
    fail("INVALID_TARGET", 400);
  const [path, query, ...rest] = raw.split("?");
  if (
    rest.length ||
    path.includes("%") ||
    path.includes("//") ||
    path.split("/").some((x) => x === "." || x === "..") ||
    !/^\/[A-Za-z0-9/_-]+$/.test(path)
  )
    fail("INVALID_TARGET", 400);
  const p = new URLSearchParams(query ?? "");
  if (
    [...p].some(
      ([k, v]) => k.length > 40 || v.length > 2048 || /\p{Cc}/u.test(k + v),
    )
  )
    fail("INVALID_QUERY", 400);
  const pairs = [...p].sort(([a, x], [b, y]) =>
      a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0,
    ),
    next = new URLSearchParams(pairs).toString();
  return path + (next ? "?" + next : "");
}
export const requestDigest = (method, target, bytes) =>
  hash(
    Buffer.concat([
      Buffer.from(method + "\n" + canonicalTarget(target) + "\n"),
      bytes,
    ]),
  );
const keyCheck = (key, privateKey = false) => {
  const obj = privateKey ? createPrivateKey(key) : createPublicKey(key);
  if (
    obj.asymmetricKeyType !== "ec" ||
    obj.asymmetricKeyDetails.namedCurve !== "prime256v1"
  )
    fail("INVALID_SIGNING_KEY", 503);
  return obj;
};
export function signAssertion({
  key,
  kid,
  context,
  method,
  target,
  body = Buffer.alloc(0),
  thumbprint,
  now = Math.floor(Date.now() / 1000),
  ttl = 45,
  jti = randomBytes(24).toString("base64url"),
}) {
  if (
    !integer(ttl) ||
    ttl < 1 ||
    ttl > 60 ||
    !hex(thumbprint) ||
    !["GET", "POST", "DELETE"].includes(method)
  )
    fail("ASSERTION_CONFIG_INVALID", 503);
  const claims = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: context.principalId,
    owner: context.ownerId,
    iat: now,
    nbf: now,
    exp: now + ttl,
    jti,
    method,
    path: canonicalTarget(target),
    request_sha256: requestDigest(method, target, body),
    principal_epoch: context.principalEpoch,
    consent_epoch: context.consentEpoch,
    session_ref: context.sessionRef,
    identity_hash: context.identityHash,
    session_expires_at: context.sessionExpiresAt,
    cnf: { "x5t#S256": Buffer.from(thumbprint, "hex").toString("base64url") },
  };
  const header = Buffer.from(
      JSON.stringify({ alg: "ES256", typ: "JWT", kid }),
    ).toString("base64url"),
    payload = Buffer.from(JSON.stringify(claims)).toString("base64url"),
    input = header + "." + payload;
  return (
    input +
    "." +
    sign("sha256", Buffer.from(input), {
      key: keyCheck(key, true),
      dsaEncoding: "ieee-p1363",
    }).toString("base64url")
  );
}
export function verifyAssertion({
  token,
  keys,
  method,
  target,
  body,
  thumbprint,
  now = Math.floor(Date.now() / 1000),
}) {
  if (typeof token !== "string" || token.length > 8192)
    fail("SERVICE_ASSERTION_REQUIRED", 401);
  const parts = token.split(".");
  if (
    parts.length !== 3 ||
    parts.some((x) => !x || !/^[A-Za-z0-9_-]+$/.test(x))
  )
    fail("INVALID_ASSERTION", 401);
  let h, c;
  try {
    const decoded = parts.map((x) => Buffer.from(x, "base64url"));
    if (decoded.some((x, i) => x.toString("base64url") !== parts[i]))
      fail("INVALID_ASSERTION", 401);
    h = strictJSON(decoded[0]);
    c = strictJSON(decoded[1]);
  } catch {
    fail("INVALID_ASSERTION", 401);
  }
  if (
    !record(h) ||
    h.alg !== "ES256" ||
    h.typ !== "JWT" ||
    typeof h.kid !== "string" ||
    !Object.hasOwn(keys, h.kid) ||
    Object.keys(h).some((x) => !["alg", "typ", "kid"].includes(x))
  )
    fail("INVALID_ASSERTION", 401);
  const signature = Buffer.from(parts[2], "base64url");
  if (
    signature.length !== 64 ||
    !verify(
      "sha256",
      Buffer.from(parts[0] + "." + parts[1]),
      { key: keyCheck(keys[h.kid]), dsaEncoding: "ieee-p1363" },
      signature,
    )
  )
    fail("INVALID_ASSERTION", 401);
  const fields = [
    "iss",
    "aud",
    "sub",
    "owner",
    "iat",
    "nbf",
    "exp",
    "jti",
    "method",
    "path",
    "request_sha256",
    "principal_epoch",
    "consent_epoch",
    "session_ref",
    "identity_hash",
    "session_expires_at",
    "cnf",
  ];
  if (
    !record(c) ||
    Object.keys(c).length !== fields.length ||
    Object.keys(c).some((x) => !fields.includes(x)) ||
    c.iss !== ISSUER ||
    c.aud !== AUDIENCE ||
    !uuid(c.sub) ||
    typeof c.owner !== "string" ||
    c.owner.length < 1 ||
    c.owner.length > 120 ||
    !integer(c.iat) ||
    !integer(c.nbf) ||
    !integer(c.exp) ||
    c.nbf !== c.iat ||
    c.exp - c.iat > 60 ||
    c.exp <= c.iat ||
    c.iat > now + 5 ||
    c.nbf > now + 5 ||
    c.exp <= now ||
    typeof c.jti !== "string" ||
    !/^[A-Za-z0-9_-]{22,64}$/.test(c.jti) ||
    c.method !== method ||
    c.path !== canonicalTarget(target) ||
    c.request_sha256 !== requestDigest(method, target, body) ||
    !integer(c.principal_epoch) ||
    !integer(c.consent_epoch) ||
    !hex(c.session_ref) ||
    !hex(c.identity_hash) ||
    !integer(c.session_expires_at) ||
    c.session_expires_at <= now ||
    !hex(thumbprint) ||
    !record(c.cnf) ||
    Object.keys(c.cnf).length !== 1 ||
    !Object.hasOwn(c.cnf, "x5t#S256") ||
    typeof c.cnf["x5t#S256"] !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(c.cnf["x5t#S256"]) ||
    c.cnf["x5t#S256"] !==
      Buffer.from(thumbprint, "hex").toString("base64url") ||
    !["GET", "POST", "DELETE"].includes(c.method)
  )
    fail("INVALID_ASSERTION", 401);
  return c;
}
