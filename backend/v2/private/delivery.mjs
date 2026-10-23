import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { fail, hash } from "../note.mjs";

/** Purpose-separated from cursor signing. No new environment/configuration side effect.
 * Keep the injected master in server custody until all pending deliveries are drained.
 * A lost/changed key makes pending credentials unavailable, never newly authorized. */
export function deliveryCipher(master) {
  if (typeof master !== "string" || master.length < 32)
    fail("DELIVERY_KEY_UNAVAILABLE", 503);
  const key = Buffer.from(
    hkdfSync("sha256", master, "neural-brain-v2", "agent-delivery-v1", 32),
  );
  const kid = hash(key).slice(0, 32);
  const aad = (job) =>
    Buffer.from(
      JSON.stringify([
        "agent-delivery-v1",
        job.delivery_id,
        job.subject_id,
        job.owner_id,
        job.credential_hash.trim(),
        new Date(job.expires_at).toISOString(),
      ]),
    );
  return {
    seal(token, job) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(aad(job));
      const data = Buffer.concat([
        cipher.update(token, "utf8"),
        cipher.final(),
      ]);
      return {
        v: 1,
        kid,
        iv: iv.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url"),
        data: data.toString("base64url"),
      };
    },
    open(job) {
      try {
        const s = job.sealed;
        if (
          !s ||
          s.v !== 1 ||
          s.kid !== kid ||
          Object.keys(s).sort().join(",") !== "data,iv,kid,tag,v" ||
          typeof s.iv !== "string" ||
          !/^[A-Za-z0-9_-]{16}$/.test(s.iv) ||
          typeof s.tag !== "string" ||
          !/^[A-Za-z0-9_-]{22}$/.test(s.tag) ||
          typeof s.data !== "string" ||
          !/^[A-Za-z0-9_-]{64}$/.test(s.data)
        )
          throw Error();
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          Buffer.from(s.iv, "base64url"),
        );
        decipher.setAAD(aad(job));
        decipher.setAuthTag(Buffer.from(s.tag, "base64url"));
        const token = Buffer.concat([
          decipher.update(Buffer.from(s.data, "base64url")),
          decipher.final(),
        ]).toString("utf8");
        if (
          !/^nbv2_[A-Za-z0-9_-]{43}$/.test(token) ||
          hash(token) !== job.credential_hash.trim()
        )
          throw Error();
        return token;
      } catch {
        fail("DELIVERY_KEY_UNAVAILABLE", 503);
      }
    },
  };
}
