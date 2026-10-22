import { createHash, randomBytes } from "node:crypto";
import {
  noStore,
  cookieHeader,
  parsedCookie,
  safeEqual,
} from "../../auth/owner-core.ts";
import type { Store, OidcProvider } from "../../auth/owner-core.ts";
import type { OwnerAccess, ownerAccess } from "../../auth/owner-access.ts";
import type {
  PrivateTransport,
  PrivateContext,
  PrivateResponse,
} from "./contracts.ts";
import { strictJSON, fields } from "../../../backend/v2/private/validation.mjs";
const digest = (s: string) => createHash("sha256").update(s).digest("hex"),
  random = () => randomBytes(32).toString("base64url");
const FLOW_COOKIE = "__Host-nc-memory-stepup";
type Flow = {
  state: string;
  nonce: string;
  verifier: string;
  binding: string;
  sessionRef: string;
  identityHash: string;
  challengeId: string;
  expiresAt: number;
};
const codes = new Set([
  "CONSENT_REQUIRED",
  "NO_OWNER_SESSION",
  "CSRF_DENIED",
  "STEP_UP_UNAVAILABLE",
  "INVALID_FIELDS",
  "INVALID_JSON",
  "INVALID_OBJECT",
  "PAYLOAD_TOO_LARGE",
  "CHALLENGE_EXPIRED",
  "STALE_INTENT",
  "REVISION_CONFLICT",
  "PROPOSAL_ALREADY_REVIEWED",
  "ROLE_FORBIDDEN",
  "RATE_LIMITED",
  "CHALLENGE_LIMIT",
  "OWNER_PROOF_INVALID",
  "PRIVATE_CONNECTIVITY_UNAVAILABLE",
  "REMOTE_NOT_CONFIGURED",
]);
function json(status: number, body: unknown): Response {
  const h = noStore();
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set("Vary", "Cookie");
  return new Response(JSON.stringify(body), { status, headers: h });
}
function redirect(location: string, clear = false): Response {
  const h = noStore();
  h.set("Vary", "Cookie");
  h.set("Location", location);
  if (clear) h.append("Set-Cookie", cookieHeader(FLOW_COOKIE, "", 0));
  return new Response(null, { status: 303, headers: h });
}
function codeOf(e: unknown): string {
  const c = e instanceof Error ? e.message : "";
  return codes.has(c) ? c : "PRIVATE_CONNECTIVITY_UNAVAILABLE";
}
async function input(req: Request): Promise<Record<string, unknown>> {
  if (
    !/^application\/json(?:; charset=utf-8)?$/.test(
      req.headers.get("content-type") ?? "",
    ) ||
    req.headers.has("content-encoding")
  )
    throw Error("INVALID_JSON");
  if (Number(req.headers.get("content-length") ?? 0) > 240000)
    throw Error("PAYLOAD_TOO_LARGE");
  let n = 0;
  const parts: Uint8Array[] = [];
  if (req.body)
    for await (const part of req.body as unknown as AsyncIterable<Uint8Array>) {
      n += part.byteLength;
      if (n > 240000) throw Error("PAYLOAD_TOO_LARGE");
      parts.push(part);
    }
  return strictJSON(Buffer.concat(parts));
}
/** Injection-only core: existing owner session/CSRF implementation + authenticated transport. */
export function createPrivateBff({
  access,
  transport,
  identity,
  store,
  provider,
  stepUpQualified = false,
  origin,
  clock = Date.now,
}: {
  access: ReturnType<typeof ownerAccess>;
  transport: PrivateTransport;
  identity: { principalId: string; ownerId: string };
  store: Store;
  provider: OidcProvider;
  stepUpQualified?: boolean;
  origin: string;
  clock?: () => number;
}) {
  const prefix = "nc:memory:stepup:" + digest(origin) + ":",
    flowKey = (state: string) => prefix + digest(state);
  const bootstrap = (a: OwnerAccess): PrivateContext => ({
    ...identity,
    identityHash: a.identityHash,
    sessionRef: a.sessionRef,
    sessionExpiresAt: Math.floor(a.expiresAt / 1000),
    principalEpoch: 0,
    consentEpoch: 0,
  });
  const response = (r: PrivateResponse) => {
    if (r.status < 200 || r.status >= 300) {
      const c =
        typeof r.body.error === "string" &&
        /^[A-Z0-9_]{2,64}$/.test(r.body.error)
          ? r.body.error
          : "PRIVATE_CONNECTIVITY_UNAVAILABLE";
      return json(r.status, { error: c });
    }
    if (
      r.body.schemaVersion !== 3 ||
      typeof r.body.confirmedAt !== "string" ||
      !Number.isFinite(Date.parse(r.body.confirmedAt)) ||
      !Object.hasOwn(r.body, "data")
    )
      return json(503, { error: "INVALID_PRIVATE_RESPONSE" });
    return json(r.status, r.body);
  };
  const handshake = async (
    a: OwnerAccess,
    signal: AbortSignal,
  ): Promise<PrivateContext> => {
    const result = await transport.call(
      bootstrap(a),
      "GET",
      "/v2/private/session",
      undefined,
      signal,
    );
    if (
      result.status !== 200 ||
      !result.body.data ||
      typeof result.body.data !== "object"
    )
      throw Error(
        result.body.error === "NO_OWNER_SESSION"
          ? "NO_OWNER_SESSION"
          : "PRIVATE_CONNECTIVITY_UNAVAILABLE",
      );
    const d = result.body.data as Record<string, unknown>;
    if (
      d.principalId !== identity.principalId ||
      d.ownerId !== identity.ownerId ||
      d.identityHash !== a.identityHash ||
      d.sessionRef !== a.sessionRef ||
      d.sessionExpiresAt !== Math.floor(a.expiresAt / 1000) ||
      !Number.isSafeInteger(d.principalEpoch) ||
      !Number.isSafeInteger(d.consentEpoch) ||
      Number(d.principalEpoch) < 1 ||
      Number(d.consentEpoch) < 1 ||
      typeof d.consented !== "boolean"
    )
      throw Error("PRIVATE_CONNECTIVITY_UNAVAILABLE");
    return {
      ...bootstrap(a),
      principalEpoch: Number(d.principalEpoch),
      consentEpoch: Number(d.consentEpoch),
      consented: d.consented,
    };
  };
  return async (req: Request): Promise<Response> => {
    try {
      const signal = AbortSignal.any([req.signal, AbortSignal.timeout(10000)]);
      const url = new URL(req.url),
        rawPath = url.pathname,
        base = "/api/brain/v2/";
      if (
        !rawPath.startsWith(base) ||
        rawPath.includes("%") ||
        rawPath.includes("//") ||
        rawPath.endsWith("/")
      )
        return json(404, { error: "NOT_FOUND" });
      const path = rawPath.slice(base.length),
        callback = path === "step-up/callback",
        a = await access.read(req, req.method !== "GET");
      const context = await handshake(a, signal);
      if (path === "capability" && req.method === "GET") {
        if (url.search) return json(400, { error: "INVALID_QUERY" });
        return json(200, {
          schemaVersion: 3,
          confirmedAt: new Date(clock()).toISOString(),
          data: {
            configured: true,
            consented: context.consented,
            stepUpQualified,
            remoteSynchronization: false,
          },
        });
      }
      if (path === "consent" && req.method === "POST") {
        if (url.search) return json(400, { error: "INVALID_QUERY" });
        const v = await input(req);
        fields(v, ["granted"]);
        if (typeof v.granted !== "boolean")
          return json(400, { error: "INVALID_CONSENT" });
        return response(
          await transport.call(
            bootstrap(a),
            "POST",
            "/v2/private/consent",
            v,
            signal,
          ),
        );
      }
      if (!context.consented) throw Error("CONSENT_REQUIRED");
      if (callback && req.method === "GET") {
        const state = url.searchParams.get("state"),
          binding = parsedCookie(req, FLOW_COOKIE);
        if (
          !stepUpQualified ||
          !state ||
          !/^[A-Za-z0-9_-]{43}$/.test(state) ||
          !binding ||
          url.searchParams.getAll("state").length !== 1 ||
          url.searchParams.getAll("code").length !== 1 ||
          url.searchParams.has("error")
        )
          return redirect(
            origin + "/settings?memory=step-up-unavailable",
            true,
          );
        const flow = await store.take<Flow>(flowKey(state));
        if (
          !flow ||
          flow.expiresAt <= clock() ||
          flow.sessionRef !== a.sessionRef ||
          flow.identityHash !== a.identityHash ||
          !safeEqual(digest(binding), flow.binding) ||
          !safeEqual(state, flow.state)
        )
          return redirect(
            origin + "/settings?memory=step-up-unavailable",
            true,
          );
        const verified = await provider.exchange({
          state,
          nonce: flow.nonce,
          verifier: flow.verifier,
          redirectUri: origin + base + "step-up/callback",
          currentUrl: req.url,
        });
        const authTime = access.fresh(verified, a);
        const result = await transport.call(
          context,
          "POST",
          "/v2/private/review-challenges/" + flow.challengeId + "/fresh",
          { identityHash: a.identityHash, authTime },
          signal,
        );
        if (result.status !== 200)
          return redirect(
            origin + "/settings?memory=step-up-unavailable",
            true,
          );
        return redirect(origin + "/agents?review=" + flow.challengeId, true);
      }
      const start = /^review-challenges\/([a-f0-9-]{36})\/start$/.exec(path);
      if (start && req.method === "POST") {
        if (!stepUpQualified) throw Error("STEP_UP_UNAVAILABLE");
        if (url.search) return json(400, { error: "INVALID_QUERY" });
        fields(await input(req), []);
        const challengeId = start[1]!;
        const valid = await transport.call(
          context,
          "GET",
          "/v2/private/review-challenges/" + challengeId,
          undefined,
          signal,
        );
        if (valid.status !== 200) return response(valid);
        const attempts = await store.increment(
          prefix + "quota:" + a.sessionRef,
          60,
        );
        if (attempts > 10) return json(429, { error: "RATE_LIMITED" });
        const state = random(),
          nonce = random(),
          verifier = random(),
          binding = random(),
          flow: Flow = {
            state,
            nonce,
            verifier,
            binding: digest(binding),
            sessionRef: a.sessionRef,
            identityHash: a.identityHash,
            challengeId,
            expiresAt: clock() + 120000,
          };
        if (!(await store.create(flowKey(state), flow, 120)))
          throw Error("STEP_UP_UNAVAILABLE");
        const authUrl = new URL(
          await provider.authorize({
            state,
            nonce,
            verifier,
            redirectUri: origin + base + "step-up/callback",
          }),
        );
        if (
          authUrl.protocol !== "https:" ||
          authUrl.hostname !== "accounts.google.com" ||
          authUrl.username ||
          authUrl.password
        )
          throw Error("STEP_UP_UNAVAILABLE");
        const r = json(200, {
          schemaVersion: 3,
          confirmedAt: new Date(clock()).toISOString(),
          data: {
            challengeId,
            authorizationUrl: authUrl.toString(),
            state: "fresh-auth-required",
          },
        });
        r.headers.append("Set-Cookie", cookieHeader(FLOW_COOKIE, binding, 120));
        return r;
      }
      const routes: Record<string, string> = {
        notes: "/v2/memories",
        proposals: "/v2/memories/proposals",
        graph: "/v2/graph",
        status: "/v2/sync/status",
        agents: "/v2/agents",
        "review-challenges": "/v2/private/review-challenges",
      };
      let target = routes[path];
      if (/^notes\/[a-f0-9-]{36}$/.test(path))
        target = "/v2/memories/" + path.split("/")[1];
      if (/^review-challenges\/[a-f0-9-]{36}(?:\/complete)?$/.test(path))
        target = "/v2/private/" + path;
      const writable =
        path === "proposals" ||
        path === "review-challenges" ||
        /^review-challenges\/[a-f0-9-]{36}\/complete$/.test(path);
      if (
        !target ||
        !["GET", "POST"].includes(req.method) ||
        (req.method === "POST" && !writable) ||
        (req.method === "GET" &&
          (path === "review-challenges" || path.endsWith("/complete")))
      )
        return json(404, { error: "NOT_FOUND" });
      const body = req.method === "POST" ? await input(req) : undefined;
      const result = await transport.call(
        context,
        req.method,
        target + url.search,
        body,
        signal,
      );
      await access.read(req, req.method !== "GET"); // reject stale/logout responses; never clear owner cookies
      return response(result);
    } catch (e) {
      const code = codeOf(e);
      return json(
        ["NO_OWNER_SESSION"].includes(code)
          ? 401
          : ["CONSENT_REQUIRED", "CSRF_DENIED", "STEP_UP_UNAVAILABLE"].includes(
                code,
              )
            ? 403
            : ["INVALID_FIELDS", "INVALID_JSON", "INVALID_OBJECT"].includes(
                  code,
                )
              ? 400
              : code === "PAYLOAD_TOO_LARGE"
                ? 413
                : 503,
        { error: code },
      );
    }
  };
}
