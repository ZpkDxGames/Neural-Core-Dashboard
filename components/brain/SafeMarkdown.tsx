"use client";
import { createElement, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { MarkdownDocument, MarkdownNode } from "@/lib/brain/markdown";
import { classifyUrl } from "@/lib/brain/links";
import { Modal } from "./Primitives";
export function SafeMarkdown({
  source,
  resolveWikilink = () => null,
}: {
  source: string;
  resolveWikilink?: (title: string) => string | null;
}) {
  const [doc, setDoc] = useState<MarkdownDocument | null>(null),
    [failed, setFailed] = useState(false),
    [external, setExternal] = useState<string | null>(null),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    setDoc(null);
    setFailed(false);
    let worker: Worker | null = null;
    const deadline = setTimeout(() => {
      worker?.terminate();
      setFailed(true);
    }, 10000);
    const timer = setTimeout(() => {
      try {
        worker = new Worker(
          new URL("../../lib/brain/markdown.worker.ts", import.meta.url),
          { type: "module" },
        );
        worker.onmessage = (e) => {
          clearTimeout(deadline);
          if (e.data.ok) setDoc(e.data.document as MarkdownDocument);
          else setFailed(true);
          worker?.terminate();
        };
        worker.onerror = () => {
          clearTimeout(deadline);
          setFailed(true);
          worker?.terminate();
        };
        worker.postMessage({ source });
      } catch {
        clearTimeout(deadline);
        setFailed(true);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      clearTimeout(deadline);
      worker?.terminate();
    };
  }, [source, retry]);
  function render(node: MarkdownNode, key: string, depth = 0): ReactNode {
    if (depth > 20) return null;
    const children = node.children?.map((child, i) =>
      render(child, key + "-" + i, depth + 1),
    );
    switch (node.type) {
      case "root":
        return <div key={key}>{children}</div>;
      case "text":
        return node.value ?? "";
      case "paragraph":
        return <p key={key}>{children}</p>;
      case "heading":
        return createElement(
          "h" + Math.min(6, (node.depth ?? 1) + 1),
          {
            key,
            id:
              "nb-" +
              (node.children?.map((n) => n.value ?? "").join("") ?? "heading")
                .toLowerCase()
                .replace(/[^a-z0-9_-]+/g, "-")
                .slice(0, 64),
          },
          children,
        );
      case "strong":
        return <strong key={key}>{children}</strong>;
      case "emphasis":
        return <em key={key}>{children}</em>;
      case "delete":
        return <del key={key}>{children}</del>;
      case "break":
        return <br key={key} />;
      case "thematicBreak":
        return <hr key={key} />;
      case "blockquote":
        return <blockquote key={key}>{children}</blockquote>;
      case "inlineCode":
        return <code key={key}>{node.value}</code>;
      case "code":
        return (
          <pre key={key}>
            <code>{node.value}</code>
          </pre>
        );
      case "html":
        return (
          <code key={key} className="nb-raw-html">
            {node.value}
          </code>
        );
      case "list":
        return node.ordered ? (
          <ol key={key} start={node.start ?? 1}>
            {children}
          </ol>
        ) : (
          <ul key={key}>{children}</ul>
        );
      case "listItem":
        return (
          <li key={key}>
            {typeof node.checked === "boolean" ? (
              <span
                aria-label={node.checked ? "Checked task" : "Unchecked task"}
              >
                {node.checked ? "☑ " : "☐ "}
              </span>
            ) : null}
            {children}
          </li>
        );
      case "link": {
        const verdict = classifyUrl(node.url ?? "");
        if (verdict.kind === "anchor")
          return (
            <a key={key} href={"#" + verdict.id}>
              {children}
            </a>
          );
        if (verdict.kind !== "external")
          return (
            <span
              key={key}
              className="nb-blocked"
              title="Blocked or unresolved link"
            >
              {children}
            </span>
          );
        return (
          <a
            key={key}
            href={verdict.url.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            onClick={(e) => {
              e.preventDefault();
              setExternal(verdict.url.href);
            }}
          >
            {children}
            <span className="nb-sr-only"> opens confirmation</span>
          </a>
        );
      }
      case "wikilink": {
        const noteId = resolveWikilink(node.title ?? "");
        return noteId ? (
          <Link
            key={key}
            href={"/library/note/" + encodeURIComponent(noteId) + "?demo=1"}
            prefetch={false}
          >
            {node.value}
          </Link>
        ) : (
          <span className="nb-unresolved" title="Unresolved link" key={key}>
            {node.value}
            <span className="nb-sr-only"> (Unresolved link)</span>
          </span>
        );
      }
      case "image": {
        const v = classifyUrl(node.url ?? "");
        return (
          <span key={key} className="nb-image-blocked">
            Image not loaded:{" "}
            {(node as MarkdownNode & { alt?: string }).alt?.slice(0, 80) ?? ""}
            {v.kind === "external" ? " · " + v.url.hostname : ""}
          </span>
        );
      }
      case "table":
        return (
          <div
            className="nb-table-scroll"
            key={key}
            tabIndex={0}
            role="region"
            aria-label="Markdown table"
          >
            <table>
              <tbody>{children}</tbody>
            </table>
          </div>
        );
      case "tableRow":
        return <tr key={key}>{children}</tr>;
      case "tableCell":
        return <td key={key}>{children}</td>;
      case "tableHeaderCell":
        return (
          <th key={key} scope="col">
            {children}
          </th>
        );
      default:
        return <span key={key}>{node.value ?? children}</span>;
    }
  }
  const verdict = external ? classifyUrl(external) : null;
  return (
    <>
      <div
        className="nb-prose"
        role="region"
        aria-label="Note preview"
        data-testid="nb-markdown"
        aria-busy={!doc && !failed}
      >
        {failed ? (
          <p>
            Markdown preview is unavailable.{" "}
            <button
              className="nb-button"
              onClick={() => setRetry((v) => v + 1)}
            >
              Retry preview
            </button>
          </p>
        ) : !doc ? (
          <p className="nb-helper">Preparing safe preview…</p>
        ) : (
          <>
            {doc.truncated ? (
              <p className="nb-helper" role="status">
                Large note truncated at 200 KB for preview.
              </p>
            ) : null}
            {doc.rawHtml ? (
              <p className="nb-helper">Raw HTML not rendered.</p>
            ) : null}
            {render(doc.tree, "root")}
            {Object.keys(doc.metadata).length ? (
              <details>
                <summary>Self-reported by the file</summary>
                <dl className="nb-metadata">
                  {Object.entries(doc.metadata).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{Array.isArray(v) ? v.join(", ") : String(v)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="nb-helper">
                  File metadata does not establish verification or permissions.
                </p>
              </details>
            ) : null}
          </>
        )}
      </div>
      <Modal
        open={Boolean(external)}
        onClose={() => setExternal(null)}
        title="Open an external link"
      >
        <p>Check this destination before leaving the private workspace.</p>
        <code style={{ overflowWrap: "anywhere" }}>{external}</code>
        {verdict?.kind === "external" && verdict.idn ? (
          <p>
            International characters in this address — check for lookalikes.
          </p>
        ) : null}
        {verdict?.kind === "external" && verdict.insecure ? (
          <p>Not encrypted. This link uses HTTP.</p>
        ) : null}
        <div className="nb-dialog-actions">
          <button className="nb-button" onClick={() => setExternal(null)}>
            Cancel
          </button>
          <button
            className="nb-button primary"
            onClick={() => {
              if (external && classifyUrl(external).kind === "external")
                window.open(external, "_blank", "noopener,noreferrer");
              setExternal(null);
            }}
          >
            Open in new tab
          </button>
        </div>
      </Modal>
    </>
  );
}
