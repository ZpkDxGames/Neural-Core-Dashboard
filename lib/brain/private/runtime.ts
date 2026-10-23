import {
  loadOwnerServices,
  createGoogleProvider,
} from "../../auth/owner-runtime.ts";
import { ownerAccess } from "../../auth/owner-access.ts";
import { loadPrivateConnection } from "./connection.ts";
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
  const { transport, identity } = await loadPrivateConnection();
  const stepUpQualified = env.NCORE_GOOGLE_FRESH_AUTH_QUALIFIED === "1";
  current = createPrivateBff({
    access: ownerAccess(services.config, services.store),
    transport,
    identity,
    store: services.store,
    provider: createGoogleProvider(services.config, undefined, true),
    stepUpQualified,
    origin: services.config.origin,
  });
  return current;
}
