import type { PrivateTransport } from "../../../lib/brain/private/contracts.ts";
export function createPrivateTransport(options: {
  origin: string;
  tls: { key: string; cert: string; ca: string };
  signingKey: string;
  kid: string;
  allowedServerThumbprints: Set<string>;
  timeoutMs?: number;
}): PrivateTransport;
