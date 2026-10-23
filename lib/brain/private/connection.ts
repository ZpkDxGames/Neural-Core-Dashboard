import { readFile } from "node:fs/promises";
import { createPrivateTransport } from "../../../backend/v2/private/transport.mjs";
import type { OwnerSessionRevocation } from "../../auth/owner-core.ts";
import type { PrivateTransport } from "./contracts.ts";

// Disabling the UI capability must not bypass revocation of existing SQL sessions.
// Partial private configuration therefore fails closed for family retirement too.
const connectionFields = [
  "NCORE_PRIVATE_OWNER_PRINCIPAL",
  "NCORE_PRIVATE_OWNER_ID",
  "NCORE_PRIVATE_CLIENT_KEY_FILE",
  "NCORE_PRIVATE_CLIENT_CERT_FILE",
  "NCORE_PRIVATE_CA_FILE",
  "NCORE_PRIVATE_ASSERTION_KEY_FILE",
  "NCORE_PRIVATE_SERVER_SHA256",
  "NCORE_PRIVATE_GATEWAY_ORIGIN",
  "NCORE_PRIVATE_ASSERTION_KID",
] as const;
export function privateRevocationRequired(
  env: Record<string, string | undefined> = process.env,
) {
  return (
    current !== null ||
    env.NCORE_BRAIN_PRIVATE_ENABLED === "1" ||
    env.NCORE_PRIVATE_STAGING_CERTIFIED === "1" ||
    connectionFields.some((name) => Boolean(env[name]))
  );
}
let current: {
  transport: PrivateTransport;
  identity: { principalId: string; ownerId: string };
} | null = null;
/** Server-only connection shared by the capability and family-retirement path. */
export async function loadPrivateConnection() {
  if (current) return current;
  const env = process.env;
  const principalId = env.NCORE_PRIVATE_OWNER_PRINCIPAL ?? "",
    ownerId = env.NCORE_PRIVATE_OWNER_ID ?? "";
  if (!/^[a-f0-9-]{36}$/.test(principalId) || !ownerId || ownerId.length > 120)
    throw Error("PRIVATE_IDENTITY_NOT_CONFIGURED");
  const load = async (name: string) => {
    const path = env[name];
    if (!path || !path.startsWith("/"))
      throw Error("PRIVATE_TLS_NOT_CONFIGURED");
    return readFile(path, "utf8");
  };
  const [key, cert, ca, signingKey] = await Promise.all([
    load("NCORE_PRIVATE_CLIENT_KEY_FILE"),
    load("NCORE_PRIVATE_CLIENT_CERT_FILE"),
    load("NCORE_PRIVATE_CA_FILE"),
    load("NCORE_PRIVATE_ASSERTION_KEY_FILE"),
  ]);
  const serverThumbprint = env.NCORE_PRIVATE_SERVER_SHA256 ?? "";
  if (!/^[0-9a-f]{64}$/.test(serverThumbprint))
    throw Error("PRIVATE_TLS_NOT_CONFIGURED");
  const transport = createPrivateTransport({
    origin: env.NCORE_PRIVATE_GATEWAY_ORIGIN ?? "",
    tls: { key, cert, ca },
    signingKey,
    kid: env.NCORE_PRIVATE_ASSERTION_KID ?? "staging-1",
    allowedServerThumbprints: new Set([serverThumbprint]),
  });
  current = { transport, identity: { principalId, ownerId } };
  return current;
}
/** Requires a positive, validated commit acknowledgment; 401/timeout never means success. */
export async function revokePrivateOwnerSession(
  session: OwnerSessionRevocation,
) {
  const { transport, identity } = await loadPrivateConnection();
  await revokeSessionWith(transport, identity, session);
}
export async function revokeSessionWith(
  transport: PrivateTransport,
  identity: { principalId: string; ownerId: string },
  session: OwnerSessionRevocation,
) {
  const result = await transport.call(
    {
      ...identity,
      ...session,
      sessionExpiresAt: Math.floor(session.expiresAt / 1000),
      principalEpoch: 0,
      consentEpoch: 0,
    },
    "POST",
    "/v2/private/session/revoke",
    {},
    AbortSignal.timeout(10000),
  );
  const data = result.body.data;
  if (
    result.status !== 200 ||
    result.body.schemaVersion !== 3 ||
    typeof result.body.confirmedAt !== "string" ||
    !Number.isFinite(Date.parse(result.body.confirmedAt)) ||
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    (data as Record<string, unknown>).revoked !== true ||
    (data as Record<string, unknown>).sessionRef !== session.sessionRef
  )
    throw Error("PRIVATE_REVOCATION_UNCONFIRMED");
}
