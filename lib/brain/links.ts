// lib/brain/markdown/links.ts — URL policy for untrusted Markdown. Allow-list, fail closed.
export type LinkVerdict =
  | {
      kind: "external";
      url: URL;
      insecure: boolean;
      idn: boolean;
      mailto: boolean;
    }
  | { kind: "anchor"; id: string }
  | {
      kind: "blocked";
      reason:
        | "scheme"
        | "control-chars"
        | "credentials"
        | "protocol-relative"
        | "malformed"
        | "empty";
    }
  | { kind: "unresolved" };

// C0/C1 controls, whitespace inside, zero-width, bidi embedding/override/isolate controls, BOM.
const FORBIDDEN =
  /[\u0000-\u0020\u007F-\u009F\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;
const BIDI = /[\u202A-\u202E\u2066-\u2069]/g;
const ALLOWED = new Set(["https:", "http:", "mailto:"]);

export function classifyUrl(raw: string): LinkVerdict {
  const s = raw.trim();
  if (s === "") return { kind: "blocked", reason: "empty" };
  if (s.startsWith("#"))
    return /^#[A-Za-z0-9_-]{1,64}$/.test(s)
      ? { kind: "anchor", id: "nb-" + s.slice(1) }
      : { kind: "blocked", reason: "malformed" };
  if (FORBIDDEN.test(s)) return { kind: "blocked", reason: "control-chars" };
  if (s.startsWith("//"))
    return { kind: "blocked", reason: "protocol-relative" };
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return { kind: "unresolved" };
  } // relative paths etc.
  if (!ALLOWED.has(url.protocol)) return { kind: "blocked", reason: "scheme" };
  if (url.username !== "" || url.password !== "")
    return { kind: "blocked", reason: "credentials" };
  const idn = url.hostname.split(".").some((l) => l.startsWith("xn--"));
  return {
    kind: "external",
    url,
    insecure: url.protocol === "http:",
    idn,
    mailto: url.protocol === "mailto:",
  };
}

/** Replace bidi control characters with U+FFFD so they are visible, never silently honoured. */
export const neutralizeBidi = (s: string): string =>
  s
    .replace(BIDI, "\uFFFD")
    .replace(/[\u0000\u200B-\u200F\u2060-\u2064\uFEFF]/g, "\uFFFD");
