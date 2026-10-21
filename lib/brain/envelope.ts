// lib/brain/envelope.ts
import type {
  DataEnvelope,
  DataOrigin,
  ReasonCode,
  SafeError,
} from "./types.ts";

export const unavailable = <T>(
  reason: ReasonCode,
  origin: DataOrigin = "remote",
): DataEnvelope<T> => ({ origin, state: "unavailable", reason });
export const ready = <T>(
  data: T,
  origin: DataOrigin,
  confirmedAt?: string,
): DataEnvelope<T> => ({ origin, state: "ready", data, confirmedAt });

/** Refuse to render remote data that was never confirmed (no "synced" claims without proof). */
export function assertRenderable<T>(env: DataEnvelope<T>): void {
  if (!["demo", "local", "remote"].includes(env.origin))
    throw new Error("data origin required");
  const needsProof =
    env.origin === "remote" &&
    (env.state === "ready" || env.state === "partial" || env.state === "empty");
  if (
    needsProof &&
    (!env.confirmedAt || !Number.isFinite(Date.parse(env.confirmedAt)))
  )
    throw new Error("remote envelope without confirmedAt");
}

/** Allow-list mapper: server text is never shown; message comes from fixed copy. */
export function toSafeError(
  input: unknown,
  fixedCopy: Record<string, string>,
  now = new Date(),
): SafeError {
  const o = (
    typeof input === "object" && input !== null ? input : {}
  ) as Record<string, unknown>;
  const code =
    typeof o.code === "string" && /^[A-Z0-9_]{2,64}$/.test(o.code)
      ? o.code
      : "UNKNOWN_ERROR";
  const ref =
    typeof o.ref === "string" && /^[A-Za-z0-9-]{8,64}$/.test(o.ref)
      ? o.ref
      : undefined;
  return {
    code,
    ref,
    message: fixedCopy[code] ?? "Something went wrong.",
    retryable: code !== "ROLE_FORBIDDEN",
    at: now.toISOString(),
  };
}
