import { readFile } from "node:fs/promises";
import {
  loadOwnerServices,
  createGoogleProvider,
} from "../../auth/owner-runtime.ts";
import { ownerAccess } from "../../auth/owner-access.ts";
import { createPrivateTransport } from "../../../backend/v2/private/transport.mjs";
import { createPrivateBff } from "./bff.ts";
/** Default off. Qualification flags are operator attestations, never inferred from green tests. */
export const privateConfigured = () =>
  process.env.NCORE_BRAIN_PRIVATE_ENABLED === "1" &&
  process.env.NCORE_PRIVATE_STAGING_CERTIFIED === "1";
let current: ReturnType<typeof createPrivateBff> | null = null;
export async function loadPrivateBff() {
  if (!privateConfigured()) return null;
  if (current) return current;
  const services = loadOwnerServices();
  if (!services) throw Error("AUTH_NOT_CONFIGURED");
  const env = process.env;
  const principalId = env.NCORE_PRIVATE_OWNER_PRINCIPAL ?? "",
    ownerId = env.NCORE_PRIVATE_OWNER_ID ?? "";
  if (!/^[a-f0-9-]{36}$/.test(principalId) || !ownerId || ownerId.length > 120)
    throw Error("PRIVATE_IDENTITY_NOT_CONFIGURED");
  const load = async (name: string) => {
    const p = env[name];
    if (!p || !p.startsWith("/")) throw Error("PRIVATE_TLS_NOT_CONFIGURED");
    return readFile(p, "utf8");
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
  const stepUpQualified = env.NCORE_GOOGLE_FRESH_AUTH_QUALIFIED === "1";
  current = createPrivateBff({
    access: ownerAccess(services.config, services.store),
    transport,
    identity: { principalId, ownerId },
    store: services.store,
    provider: createGoogleProvider(services.config, undefined, true),
    stepUpQualified,
    origin: services.config.origin,
  });
  return current;
}
