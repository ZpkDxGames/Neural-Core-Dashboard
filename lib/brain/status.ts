// lib/brain/status.ts — single source of truth for status labels/tones/icons.
export type Tone = "neutral" | "ok" | "warn" | "danger" | "accent";
export interface StatusDef {
  label: string;
  tone: Tone;
  icon: string;
  help?: string;
}

export const STATUS_REGISTRY = {
  "sync.local-only": { label: "Local only", tone: "neutral", icon: "house" },
  "sync.signed-out": { label: "Signed out", tone: "neutral", icon: "key-off" },
  "sync.remote-ready": {
    label: "Remote ready",
    tone: "ok",
    icon: "server-check",
  },
  "sync.pending": { label: "Pending", tone: "warn", icon: "clock" },
  "sync.conflict": { label: "Conflict", tone: "danger", icon: "split" },
  "sync.disconnected": {
    label: "Disconnected",
    tone: "danger",
    icon: "plug-off",
  },
  "sync.stale": { label: "Stale", tone: "warn", icon: "hourglass-off" },
  "sync.failed": { label: "Failed", tone: "danger", icon: "x-circle" },
  "trust.verified": { label: "Verified", tone: "ok", icon: "check-circle" },
  "trust.proposed": {
    label: "Agent suggestion",
    tone: "accent",
    icon: "dashed-circle",
    help: "Not verified.",
  },
  "trust.heuristic": {
    label: "Rule-based",
    tone: "neutral",
    icon: "dotted-circle",
    help: "Found by simple matching rules. Not verified.",
  },
  "trust.rejected": {
    label: "Rejected",
    tone: "neutral",
    icon: "slash-circle",
  },
  "pub.pending": { label: "Queued to publish", tone: "warn", icon: "clock" },
  "pub.publishing": { label: "Publishing", tone: "warn", icon: "clock-arrow" },
  "pub.committed": { label: "Published", tone: "ok", icon: "check" },
  "pub.failed": { label: "Publish failed", tone: "danger", icon: "x-circle" },
  "pub.conflict": { label: "Publish conflict", tone: "danger", icon: "split" },
  "session.disabled": {
    label: "Owner sign-in off",
    tone: "neutral",
    icon: "key-off",
  },
  "session.loading": {
    label: "Checking session",
    tone: "neutral",
    icon: "spinner",
  },
  "session.signed-out": {
    label: "Signed out",
    tone: "neutral",
    icon: "key-off",
  },
  "session.signed-in": { label: "Signed in", tone: "ok", icon: "user-check" },
  "session.error": {
    label: "Session check failed",
    tone: "danger",
    icon: "x-circle",
  },
  "origin.demo": { label: "Demo · synthetic", tone: "neutral", icon: "flask" },
  "flag.conflict": { label: "Has conflict", tone: "danger", icon: "split" },
  "flag.stale": { label: "Stale", tone: "warn", icon: "hourglass-off" },
} as const satisfies Record<string, StatusDef>;

export type StatusKey = keyof typeof STATUS_REGISTRY;
export type SyncKey = Extract<StatusKey, `sync.${string}`>;
