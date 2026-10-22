import { createServer } from "node:https";
import { hash, BrainError, fail, uuid } from "../note.mjs";
import { canonicalTarget, verifyAssertion } from "./assertions.mjs";
import { privateRequestScope } from "./deadline.mjs";
import {
  readBytes,
  strictJSON,
  fields,
  query,
  pageQuery,
} from "./validation.mjs";
const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, private",
  vary: "Authorization",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};
function send(res, status, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > 262144) {
    res.writeHead(413, headers);
    res.end('{"error":"RESPONSE_BUDGET_EXCEEDED"}');
    return;
  }
  res.writeHead(status, headers);
  res.end(bytes);
}
/** No listener or environment switch. Explicit local/staging composition only. */
export function makePrivateGatewayHandler({
  engine,
  authority,
  keys,
  allowedClientThumbprints,
  enabled = false,
  clock = () => Date.now(),
  report = () => {},
}) {
  let active = 0;
  return async (req, res) =>
    privateRequestScope.run({ deadlineAt: Date.now() + 10000 }, async () => {
      if (!enabled) return send(res, 404, { error: "NOT_FOUND" });
      if (active >= 2) return send(res, 429, { error: "BUSY" });
      active++;
      const timer = setTimeout(() => {
        req.destroy();
        res.destroy();
      }, 10000);
      timer.unref();
      let action = "private-request";
      try {
        if (
          !req.socket.encrypted ||
          req.socket.getProtocol() !== "TLSv1.3" ||
          !req.socket.authorized
        )
          fail("MTLS_REQUIRED", 401);
        const cert = req.socket.getPeerCertificate(),
          thumbprint = cert?.raw ? hash(cert.raw) : "";
        if (!allowedClientThumbprints.has(thumbprint))
          fail("CLIENT_IDENTITY_REJECTED", 401);
        if (
          req.headers.origin ||
          req.headers.cookie ||
          req.headers["sec-fetch-site"] ||
          req.headers["x-owner-proof"] ||
          (req.headers["transfer-encoding"] && req.headers["content-length"])
        )
          fail("BROWSER_ACCESS_DENIED", 403);
        const target = canonicalTarget(req.url);
        if (req.url !== target) fail("NONCANONICAL_TARGET", 400);
        if (
          req.headers["content-encoding"] &&
          req.headers["content-encoding"] !== "identity"
        )
          fail("COMPRESSION_NOT_SUPPORTED", 415);
        if (
          req.headers["content-length"] &&
          (!/^\d+$/.test(req.headers["content-length"]) ||
            Number(req.headers["content-length"]) > 240000)
        )
          fail("PAYLOAD_TOO_LARGE", 413);
        const bytes = await readBytes(req),
          method = req.method;
        if (method === "GET" && bytes.length) fail("GET_BODY_DENIED", 400);
        if (
          method === "POST" &&
          !/^application\/json(?:; charset=utf-8)?$/.test(
            req.headers["content-type"] ?? "",
          )
        )
          fail("JSON_REQUIRED", 415);
        const token = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(
            req.headers.authorization ?? "",
          )?.[1],
          now = Math.floor(clock() / 1000);
        const claims = verifyAssertion({
          token,
          keys,
          method,
          target,
          body: bytes,
          thumbprint,
          now,
        });
        // Atomic, shared SQL replay and quota stores. Outages deny; no positive cache.
        await engine.tx(async (db) => {
          await db.query(
            "DELETE FROM vault_service_replays WHERE jti_hash IN (SELECT jti_hash FROM vault_service_replays WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 100)",
          );
          const inserted = await db.query(
            "INSERT INTO vault_service_replays(jti_hash,expires_at) VALUES($1,to_timestamp($2)) ON CONFLICT DO NOTHING RETURNING jti_hash",
            [hash(claims.jti), claims.exp],
          );
          if (!inserted.rows.length) fail("ASSERTION_REPLAY", 401);
          const q = await db.query(
            `INSERT INTO vault_private_quota(principal_id,minute,count) VALUES($1,$2,1) ON CONFLICT(principal_id,minute)
     DO UPDATE SET count=vault_private_quota.count+1 WHERE vault_private_quota.count<60 RETURNING count`,
            [claims.sub, Math.floor(now / 60)],
          );
          if (!q.rows.length) fail("RATE_LIMITED", 429);
          await db.query("DELETE FROM vault_private_quota WHERE minute<$1", [
            Math.floor(now / 60) - 1,
          ]);
        });
        const path = target.split("?")[0],
          bootstrap =
            path === "/v2/private/session" || path === "/v2/private/consent";
        const p = await authority.resolve(claims, { bootstrap });
        const input = method === "POST" ? strictJSON(bytes) : null;
        let data;
        if (path === "/v2/private/session" && method === "GET") {
          query(target, []);
          data = authority.context(p);
        } else if (path === "/v2/private/consent" && method === "POST") {
          query(target, []);
          fields(input, ["granted"]);
          data = await authority.consent(p, input.granted);
        } else if (path === "/v2/memories/proposals" && method === "GET") {
          data = await engine.proposals(p, pageQuery(target, true));
          const actors = await engine.tx(async (db) => {
            await engine.authorize(db, p, "read");
            return (
              await db.query(
                "SELECT principal_id,display_name,kind,role,scopes,disabled_at,credential_expires_at FROM vault_principals WHERE owner_id=$1 AND principal_id=ANY($2::uuid[])",
                [p.ownerId, data.items.map((x) => x.principal_id)],
              )
            ).rows;
          });
          data.items = data.items.map((x) => ({
            ...x,
            author: actors.find((a) => a.principal_id === x.principal_id),
          }));
        } else if (path === "/v2/memories/proposals" && method === "POST") {
          query(target, []);
          fields(
            input,
            ["noteId", "baseRevision", "note", "idempotencyKey"],
            ["note", "idempotencyKey"],
          );
          const { idempotencyKey, ...proposal } = input;
          data = await engine.submit(p, proposal, idempotencyKey);
        } else if (path === "/v2/memories" && method === "GET")
          data = await engine.list(p, pageQuery(target));
        else if (
          /^\/v2\/memories\/[a-f0-9-]{36}$/.test(path) &&
          method === "GET"
        ) {
          query(target, []);
          data = await engine.get(p, path.split("/")[3]);
        } else if (path === "/v2/graph" && method === "GET") {
          const q = query(target, ["focus", "depth", "limit", "cursor"]),
            depth = q.get("depth") ?? "1",
            limit = q.get("limit") ?? "150";
          if (
            !/^[123]$/.test(depth) ||
            !/^\d{1,3}$/.test(limit) ||
            Number(limit) < 1 ||
            Number(limit) > 300 ||
            (q.has("focus") && !uuid(q.get("focus")))
          )
            fail("INVALID_GRAPH_QUERY", 400);
          data = await engine.graph(p, {
            focus: q.get("focus"),
            depth: Number(depth),
            limit: Number(limit),
            cursor: q.get("cursor"),
          });
        } else if (path === "/v2/sync/status" && method === "GET") {
          query(target, []);
          data = await engine.status(p);
        } else if (path === "/v2/agents" && method === "GET") {
          query(target, []);
          data = await engine.agents(p);
        } else if (
          path === "/v2/private/review-challenges" &&
          method === "POST"
        ) {
          query(target, []);
          data = await authority.challenge(p, input);
          action = "owner-challenge";
        } else {
          const m =
            /^\/v2\/private\/review-challenges\/([a-f0-9-]{36})(?:\/(fresh|complete))?$/.exec(
              path,
            );
          if (!m) fail("NOT_FOUND", 404);
          query(target, []);
          action = "owner-" + (m[2] ?? "receipt");
          if (method === "GET" && !m[2])
            data = await authority.receipt(p, m[1]);
          else if (method === "POST" && m[2] === "fresh") {
            fields(input, ["identityHash", "authTime"]);
            data = await authority.fresh(p, m[1], input);
          } else if (method === "POST" && m[2] === "complete") {
            fields(input, []);
            data = await authority.complete(p, m[1]);
          } else fail("METHOD_NOT_ALLOWED", 405);
        }
        // Recheck the primary session store after work and before any response bytes.
        await authority.online(claims);
        if (!allowedClientThumbprints.has(thumbprint))
          fail("CLIENT_IDENTITY_REJECTED", 401);
        send(res, 200, {
          schemaVersion: 3,
          confirmedAt: new Date(clock()).toISOString(),
          data,
        });
      } catch (e) {
        const code =
          e instanceof BrainError ? e.code : "PRIVATE_SERVICE_UNAVAILABLE";
        report({ action, outcome: code });
        send(res, e instanceof BrainError ? e.status : 503, { error: code });
      } finally {
        clearTimeout(timer);
        active--;
      }
    });
}
export function createPrivateGatewayServer({ tls, ...options }) {
  if (!tls?.key || !tls.cert || !tls.ca) fail("MTLS_CONFIG_REQUIRED", 503);
  const server = createServer(
    {
      ...tls,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
      requestCert: true,
      rejectUnauthorized: true,
    },
    makePrivateGatewayHandler(options),
  );
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 32;
  return server;
}
