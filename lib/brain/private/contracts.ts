export type PrivateContext = {
  principalId: string;
  ownerId: string;
  principalEpoch: number;
  consentEpoch: number;
  sessionRef: string;
  identityHash: string;
  sessionExpiresAt: number;
  consented?: boolean;
};
export type PrivateResponse = { status: number; body: Record<string, unknown> };
export interface PrivateTransport {
  call(
    context: PrivateContext,
    method: string,
    target: string,
    value?: unknown,
    signal?: AbortSignal,
  ): Promise<PrivateResponse>;
  close(): void;
}
export type ReviewChallenge = {
  challengeId: string;
  subjectId: string;
  decision: "verify" | "publish-unverified" | "reject";
  expectedRevision: number;
  intentSha256: string;
  expiresAt: string;
  state: string;
};
