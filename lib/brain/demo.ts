import type { NoteDetail } from "./types";
export const DEMO_NOTES: NoteDetail[] = [
  {
    noteId: "550e8400-e29b-41d4-a716-446655440000",
    title: "A memory is only as useful as its evidence",
    type: "decision",
    revision: 3,
    updatedAt: "2026-10-20T12:00:00Z",
    tags: ["architecture", "provenance"],
    trust: "proposed",
    publication: null,
    hasConflict: false,
    origin: "demo",
    body: "## Keep the source close\n\nThis is a **synthetic design example**, not a personal memory. A curated note should explain both what it says and where the claim came from.\n\n### Three useful boundaries\n\n- An agent suggests a change.\n- The owner reviews its evidence.\n- The vault worker confirms publication.\n\nA note can reference [[Private publication protocol]] without embedding the source.\n\n> An attractive graph is useful when every connection has an explanation.\n\n| Layer | Responsibility |\n| --- | --- |\n| Markdown | Human-readable knowledge |\n| PostgreSQL | Evidence and coordination |\n\n`state: verified` in frontmatter never grants trust.",
    selfReported: { state: "verified", brain_schema: "1" },
    evidence: [
      {
        kind: "conversation",
        provider: "generic",
        sourceId: "synth-conversation-42",
        messageId: "synth-message-1",
        consent: "unknown",
        resolvable: false,
      },
    ],
  },
  {
    noteId: "550e8400-e29b-41d4-a716-446655440001",
    title: "Private publication protocol",
    type: "reference",
    revision: 1,
    updatedAt: "2026-10-20T12:00:00Z",
    tags: ["publication", "recovery"],
    trust: "proposed",
    publication: null,
    hasConflict: false,
    origin: "demo",
    body: "## A recoverable publication\n\nThis is a synthetic example. SQL commits and filesystem renames are coordinated through a durable outbox.\n\n1. Validate the proposal and its source evidence.\n2. Record a revision and a publication event.\n3. Publish Markdown with an atomic rename.\n4. Confirm its hash before updating the read model.\n\nSee [[A memory is only as useful as its evidence]] for the provenance boundary.",
    selfReported: { state: "proposed" },
    evidence: [
      {
        kind: "manual",
        sourceId: "synth-manual-example",
        consent: "unknown",
        resolvable: false,
      },
    ],
  },
];
