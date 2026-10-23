import { fail } from "../note.mjs";
/** Bounded JSON parser with duplicate-member rejection, including escaped duplicate names. */
export function strictJSON(bytes) {
  let s;
  try {
    s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("INVALID_JSON", 400);
  }
  let i = 0;
  const ws = () => {
    while (/[\t\r\n ]/.test(s[i] ?? "x")) i++;
  };
  const string = () => {
    const start = i++;
    while (i < s.length) {
      const c = s[i++];
      if (c === '"') {
        try {
          return JSON.parse(s.slice(start, i));
        } catch {
          break;
        }
      }
      if (c === "\\") i++;
    }
    fail("INVALID_JSON", 400);
  };
  const value = (depth) => {
    if (depth > 32) fail("INVALID_JSON", 400);
    ws();
    const c = s[i];
    if (c === '"') return string();
    if (c === "{" || c === "[") {
      i++;
      const object = c === "{",
        out = object ? {} : [],
        keys = new Set(),
        end = object ? "}" : "]";
      ws();
      if (s[i] === end) {
        i++;
        return out;
      }
      while (i < s.length) {
        ws();
        let k;
        if (object) {
          if (s[i] !== '"') fail("INVALID_JSON", 400);
          k = string();
          if (
            keys.has(k) ||
            ["__proto__", "constructor", "prototype"].includes(k)
          )
            fail("DUPLICATE_OR_UNSAFE_MEMBER", 400);
          keys.add(k);
          ws();
          if (s[i++] !== ":") fail("INVALID_JSON", 400);
        }
        const v = value(depth + 1);
        if (object) out[k] = v;
        else out.push(v);
        ws();
        if (s[i] === end) {
          i++;
          return out;
        }
        if (s[i++] !== ",") fail("INVALID_JSON", 400);
      }
      fail("INVALID_JSON", 400);
    }
    const m =
      /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(
        s.slice(i),
      );
    if (!m) fail("INVALID_JSON", 400);
    i += m[0].length;
    const v = JSON.parse(m[0]);
    if (typeof v === "number" && !Number.isFinite(v)) fail("INVALID_JSON", 400);
    return v;
  };
  const out = value(0);
  ws();
  if (i !== s.length || !out || typeof out !== "object" || Array.isArray(out))
    fail("INVALID_OBJECT", 400);
  return out;
}
export function fields(value, allowed, required = allowed) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k)) ||
    required.some((k) => !Object.hasOwn(value, k))
  )
    fail("INVALID_FIELDS", 400);
  return value;
}
export function query(target, allowed, repeated = []) {
  const url = new URL(target, "https://private.invalid");
  if (
    [...url.searchParams.keys()].some((k) => !allowed.includes(k)) ||
    allowed.some(
      (k) => !repeated.includes(k) && url.searchParams.getAll(k).length > 1,
    )
  )
    fail("INVALID_QUERY", 400);
  return url.searchParams;
}
export function pageQuery(target, proposals = false) {
  const p = query(
      target,
      proposals
        ? ["limit", "cursor", "status", "type"]
        : ["limit", "cursor", "q"],
      proposals ? ["status", "type"] : [],
    ),
    limit = p.get("limit") ?? "25";
  if (!/^[1-9][0-9]?$/.test(limit) || Number(limit) > 50)
    fail("INVALID_LIMIT", 400);
  return {
    limit: Number(limit),
    cursor: p.get("cursor"),
    ...(proposals
      ? {
          ...(p.has("status") ? { statuses: p.getAll("status") } : {}),
          noteTypes: p.getAll("type"),
        }
      : { q: p.get("q") ?? "" }),
  };
}
export async function readBytes(stream, max = 240000) {
  let n = 0;
  const chunks = [];
  for await (const c of stream) {
    const b = Buffer.from(c);
    n += b.length;
    if (n > max) fail("PAYLOAD_TOO_LARGE", 413);
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}
