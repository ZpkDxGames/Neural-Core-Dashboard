import { createHash } from "node:crypto";
import {
  readAuthorizedOwnerSession,
  ownerStorePrefix,
  exactOrigin,
  csrfToken,
  safeEqual,
  ownerAllowed,
} from "./owner-core.ts";
import type { OwnerConfig, Store } from "./owner-core.ts";
export type OwnerAccess = {
  identityHash: string;
  sessionRef: string;
  expiresAt: number;
  sub: string;
};
const digest = (x: string) => createHash("sha256").update(x).digest("hex");
export function ownerAccess(
  config: OwnerConfig,
  store: Store,
  clock = Date.now,
) {
  return {
    async read(req: Request, mutation = false): Promise<OwnerAccess> {
      if (
        new URL(req.url).origin !== config.origin ||
        req.headers.get("sec-fetch-site") === "cross-site" ||
        req.headers.get("sec-fetch-site") === "same-site" ||
        (req.headers.get("origin") &&
          req.headers.get("origin") !== config.origin)
      )
        throw Error("CSRF_DENIED");
      const current = await readAuthorizedOwnerSession(
        req,
        config,
        store,
        clock,
      );
      if (!current) throw Error("NO_OWNER_SESSION");
      if (
        mutation &&
        (!exactOrigin(req, config.origin) ||
          !safeEqual(
            req.headers.get("x-ncore-csrf"),
            csrfToken(config.csrfSecret, current.token),
          ))
      )
        throw Error("CSRF_DENIED");
      return {
        identityHash: digest(current.saved.sub),
        sessionRef: digest(current.saved.family),
        expiresAt: current.saved.expiresAt,
        sub: current.saved.sub,
      };
    },
    /** Gateway primary-store verifier; no cached positive authorization. */
    async verifyFamily({
      sessionRef,
      identityHash,
    }: {
      sessionRef: string;
      identityHash: string;
    }): Promise<{ expiresAt: number } | null> {
      if (
        !/^[0-9a-f]{64}$/.test(sessionRef) ||
        identityHash !== digest(config.ownerSub)
      )
        return null;
      const value = await store.get<{ sub: string; expiresAt: number }>(
        ownerStorePrefix(config) + "family:" + sessionRef,
      );
      return value &&
        value.sub === config.ownerSub &&
        Number.isSafeInteger(value.expiresAt) &&
        value.expiresAt > clock()
        ? { expiresAt: value.expiresAt }
        : null;
    },
    fresh(
      identity: {
        sub?: unknown;
        email_verified?: unknown;
        auth_time?: unknown;
      },
      access: OwnerAccess,
    ): number {
      if (
        !ownerAllowed(identity, config.ownerSub) ||
        identity.sub !== access.sub ||
        !Number.isSafeInteger(identity.auth_time)
      )
        throw Error("STEP_UP_UNAVAILABLE");
      const at = identity.auth_time as number,
        now = Math.floor(clock() / 1000);
      if (at < now - 120 || at > now + 5) throw Error("STEP_UP_UNAVAILABLE");
      return at;
    },
  };
}
