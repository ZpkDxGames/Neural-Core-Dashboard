import type { DataEnvelope, Proposal } from "./types.ts";
import type { DraftState } from "./diff.ts";
import { reduceDraft } from "./diff.ts";
type ReviewAck = { id: string };
type ReviewTransport = (
  id: string,
  decision: "verify" | "reject",
  revision: number,
  signal: AbortSignal,
) => Promise<DataEnvelope<ReviewAck>>;
/** UI coordination only. The default dashboard never supplies a remote transport.
 * The server is responsible for permission, proof, revision and evidence checks. */
export class ReviewCoordinator {
  items: Proposal[] = [];
  pending: string | null = null;
  error: string | null = null;
  private transport: ReviewTransport;
  private owner: boolean;
  constructor(transport: ReviewTransport, owner: boolean) {
    this.transport = transport;
    this.owner = owner;
  }
  async decide(
    id: string,
    decision: "verify" | "reject",
    revision: number,
    confirmed: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.owner) throw Error("ROLE_FORBIDDEN");
    if (!confirmed) throw Error("CONFIRMATION_REQUIRED");
    if (this.pending) throw Error("BUSY");
    if (
      !Number.isInteger(revision) ||
      revision < 0 ||
      !this.items.some((p) => p.id === id)
    )
      throw Error("STALE_SELECTION");
    this.pending = id;
    this.error = null;
    try {
      const ack = await this.transport(id, decision, revision, signal);
      if (signal.aborted) return;
      if (ack.state !== "ready" || !validAck(ack) || ack.data.id !== id) {
        this.error =
          ack.state === "error" ? ack.error.code : "UNCONFIRMED_REVIEW";
        return;
      }
      this.items = this.items.filter((p) => p.id !== id);
    } catch {
      if (!signal.aborted) this.error = "REVIEW_FAILED";
    } finally {
      this.pending = null;
    }
  }
}
function validAck(value: DataEnvelope<unknown>): boolean {
  return (
    value.origin !== "local" &&
    Number.isFinite(Date.parse(value.confirmedAt ?? "")) &&
    (value.origin === "demo" || Boolean(value.endpoint))
  );
}
export class DraftCoordinator {
  state: DraftState = "editing";
  confirmedAt: string | null = null;
  error: string | null = null;
  queue() {
    this.state = reduceDraft(this.state, { kind: "queue" });
    this.error = null;
  }
  sending(online: boolean) {
    if (online) this.state = reduceDraft(this.state, { kind: "send" });
  }
  acknowledge(
    ack: DataEnvelope<{
      state: "accepted" | "publishing" | "committed" | "failed" | "conflict";
    }>,
  ) {
    if (ack.state !== "ready" || !validAck(ack)) {
      this.error = "UNCONFIRMED_PUBLICATION";
      return;
    }
    if (this.state === "editing") return;
    this.state = reduceDraft(this.state, {
      kind: "ack",
      state: ack.data.state,
      confirmedAt: ack.confirmedAt!,
    });
    this.confirmedAt = ack.confirmedAt!;
  }
}
