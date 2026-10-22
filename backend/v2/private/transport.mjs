import { Agent, request } from "node:https";
import { checkServerIdentity } from "node:tls";
import { X509Certificate } from "node:crypto";
import { canonicalTarget, signAssertion } from "./assertions.mjs";
import { strictJSON } from "./validation.mjs";
import { hash, fail } from "../note.mjs";
/** Only a fixed private origin. No arbitrary URL, redirects, proxy, or browser token forwarding. */
export function createPrivateTransport({
  origin,
  tls,
  signingKey,
  kid,
  allowedServerThumbprints,
  timeoutMs = 10000,
}) {
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !tls?.ca ||
    !tls.cert ||
    !tls.key ||
    !allowedServerThumbprints?.size
  )
    fail("PRIVATE_TRANSPORT_CONFIG", 503);
  const thumbprint = hash(new X509Certificate(tls.cert).raw);
  const agent = new Agent({
    ...tls,
    minVersion: "TLSv1.3",
    maxVersion: "TLSv1.3",
    rejectUnauthorized: true,
    maxSockets: 2,
    maxTotalSockets: 2,
    maxFreeSockets: 0,
    keepAlive: false,
    maxCachedSessions: 0,
    checkServerIdentity(host, cert) {
      const error = checkServerIdentity(host, cert);
      if (error) return error;
      if (!allowedServerThumbprints.has(hash(cert.raw)))
        return Error("SERVER_IDENTITY_REJECTED");
    },
  });
  return {
    async call(context, method, target, value, signal) {
      const canonical = canonicalTarget(target),
        body =
          value === undefined
            ? Buffer.alloc(0)
            : Buffer.from(JSON.stringify(value));
      if (body.length > 240000) fail("PAYLOAD_TOO_LARGE", 413);
      const assertion = signAssertion({
        key: signingKey,
        kid,
        context,
        method,
        target: canonical,
        body,
        thumbprint,
      });
      return new Promise((resolve, reject) => {
        const req = request(
          new URL(canonical, url),
          {
            method,
            agent,
            signal,
            headers: {
              authorization: "Bearer " + assertion,
              ...(method === "POST"
                ? {
                    "content-type": "application/json",
                    "content-length": body.length,
                  }
                : {}),
            },
          },
          (res) => {
            let n = 0;
            const chunks = [];
            res.on("data", (c) => {
              n += c.length;
              if (n > 262144) {
                res.destroy();
                reject(Error("RESPONSE_BUDGET_EXCEEDED"));
              } else chunks.push(c);
            });
            res.on("error", () =>
              reject(Error("PRIVATE_CONNECTIVITY_UNAVAILABLE")),
            );
            res.on("end", () => {
              try {
                const data = strictJSON(Buffer.concat(chunks));
                if (
                  !res.headers["content-type"]?.startsWith("application/json")
                )
                  throw Error();
                resolve({ status: res.statusCode, body: data });
              } catch {
                reject(Error("INVALID_PRIVATE_RESPONSE"));
              }
            });
          },
        );
        const deadline = setTimeout(
          () => req.destroy(Error("PRIVATE_REQUEST_TIMEOUT")),
          Math.min(10000, timeoutMs),
        );
        deadline.unref();
        req.on("error", () =>
          reject(Error("PRIVATE_CONNECTIVITY_UNAVAILABLE")),
        );
        req.on("close", () => clearTimeout(deadline));
        req.end(body);
      });
    },
    close() {
      agent.destroy();
    },
  };
}
