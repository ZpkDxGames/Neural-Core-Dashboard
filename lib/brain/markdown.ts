import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { neutralizeBidi } from "./links.ts";
export type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  depth?: number;
  url?: string;
  title?: string;
  ordered?: boolean;
  start?: number;
  checked?: boolean | null;
};
export type MarkdownDocument = {
  tree: MarkdownNode;
  metadata: Record<string, string | number | string[]>;
  truncated: boolean;
  rawHtml: boolean;
};
export function parseSafeMarkdown(
  source: string,
  maxBytes = 200000,
): MarkdownDocument {
  const bytes = new TextEncoder().encode(source),
    truncated = bytes.length > maxBytes;
  let text = neutralizeBidi(new TextDecoder().decode(bytes.slice(0, maxBytes))),
    metadata: MarkdownDocument["metadata"] = {};
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---\n", 4);
    if (end > 0 && end < 8192) {
      const allowed = new Set([
        "brain_schema",
        "note_id",
        "revision",
        "type",
        "state",
        "created_at",
        "updated_at",
        "agent_origin",
        "source_refs",
        "related_ids",
        "tags",
      ]);
      for (const line of text.slice(4, end).split("\n")) {
        const m = /^([a-z_]+): (.+)$/.exec(line);
        if (!m || !allowed.has(m[1]!) || Object.hasOwn(metadata, m[1]!))
          continue;
        try {
          const value = JSON.parse(m[2]!) as unknown;
          if (
            typeof value === "string" ||
            typeof value === "number" ||
            (Array.isArray(value) &&
              value.length <= 32 &&
              value.every((v) => typeof v === "string"))
          )
            metadata[m[1]!] = value as string | number | string[];
        } catch {
          /* Unrecognized YAML is displayed only as body text by the backend editor. */
        }
      }
      text = text.slice(end + 5);
    }
  }
  const root = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(text) as unknown as MarkdownNode;
  let count = 0,
    links = 0,
    rawHtml = false;
  function bound(node: MarkdownNode, depth: number): MarkdownNode {
    count++;
    if (count > 5000 || depth > 20)
      return { type: "text", value: "[Content omitted: rendering budget]" };
    if (node.type === "html") rawHtml = true;
    if (["link", "image", "wikilink"].includes(node.type) && ++links > 500)
      return { type: "text", value: "[Additional link omitted]" };
    if (node.children) {
      const children: MarkdownNode[] = [];
      for (const child of node.children.slice(
        0,
        node.type === "table" ? 201 : 2000,
      )) {
        if (child.type === "text" && child.value && node.type !== "link") {
          let start = 0;
          for (const match of child.value.matchAll(
            /!?\[\[([^\]\n]{1,180})\]\]/g,
          )) {
            const index = match.index!;
            if (index > start)
              children.push({
                type: "text",
                value: child.value.slice(start, index),
              });
            const [title = "", alias] = match[1]!.split("|");
            children.push({
              type: "wikilink",
              title: title.trim(),
              value: (alias ?? title).trim(),
            });
            start = index + match[0]!.length;
          }
          if (start) {
            if (start < child.value.length)
              children.push({ type: "text", value: child.value.slice(start) });
            continue;
          }
        }
        children.push(bound(child, depth + 1));
        if (count > 5000) break;
      }
      if (node.type === "table" && children[0]?.children)
        children[0] = {
          ...children[0],
          children: children[0].children.map((cell) => ({
            ...cell,
            type: "tableHeaderCell",
          })),
        };
      return { ...node, children };
    }
    return node;
  }
  return { tree: bound(root, 0), metadata, truncated, rawHtml };
}
