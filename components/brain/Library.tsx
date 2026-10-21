"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  MessageSquare,
  ChevronRight,
  ArrowLeft,
  Copy,
  Trash2,
  FlaskConical,
  FileText,
  Network,
  Shield,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useBrain } from "./BrainProvider";
import {
  SectionHeading,
  OriginChip,
  StateSurface,
  StatusBadge,
  ConfirmDelete,
  TruthfulButton,
} from "./Primitives";
import { messages } from "@/lib/brain/messages";
import { DEMO_NOTES } from "@/lib/brain/demo";
import { neutralizeBidi } from "@/lib/brain/links";
import { SafeMarkdown } from "./SafeMarkdown";
import { PanelBoundary } from "./PanelBoundary";
function Collections({ active }: { active: "local" | "vault" }) {
  return (
    <nav className="nb-tabs" aria-label="Library collections">
      <Link
        href="/library?collection=local"
        className="nb-tab"
        aria-current={active === "local" ? "page" : undefined}
      >
        Local archive
      </Link>
      <Link
        href="/library?collection=vault"
        className="nb-tab"
        aria-current={active === "vault" ? "page" : undefined}
      >
        Vault notes
      </Link>
    </nav>
  );
}
export function Library({
  collection = "local",
  selectedId,
  demo = false,
}: {
  collection?: string;
  selectedId?: string;
  demo?: boolean;
}) {
  return collection === "vault" ? (
    <VaultLibrary demo={demo} />
  ) : (
    <LocalLibrary selectedId={selectedId} />
  );
}
function LocalLibrary({ selectedId }: { selectedId?: string }) {
  const router = useRouter();
  const b = useBrain(),
    [provider, setProvider] = useState(""),
    [ids, setIds] = useState<string[]>([]),
    [progress, setProgress] = useState(""),
    [page, setPage] = useState(0),
    [confirm, setConfirm] = useState(false),
    [messagePage, setMessagePage] = useState(0);
  const worker = useRef<Worker | null>(null),
    sequence = useRef(0);
  const itemsById = useMemo(
    () => new Map(b.items.map((c) => [c.id, c])),
    [b.items],
  );
  const selected = selectedId ? itemsById.get(selectedId) : undefined;
  useEffect(() => {
    const next = new Worker(
      new URL("../../lib/brain/search.worker.ts", import.meta.url),
    );
    worker.current = next;
    next.postMessage({ items: b.items, id: 0 });
    next.onmessage = (e) => {
      if (e.data.id !== sequence.current) return;
      if (e.data.done) {
        setIds(e.data.ids as string[]);
        setProgress("");
      } else
        setProgress(
          `Searched ${e.data.scanned.toLocaleString()} of ${e.data.total.toLocaleString()}`,
        );
    };
    next.onerror = () => {
      setProgress("Search worker unavailable. Reload this page.");
    };
    return () => next.terminate();
  }, [b.items]);
  useEffect(() => {
    const id = ++sequence.current;
    setPage(0);
    const timer = setTimeout(() => {
      setProgress("Searching this browser…");
      worker.current?.postMessage({ id, query: b.libraryQuery, provider });
    }, 120);
    return () => clearTimeout(timer);
  }, [b.libraryQuery, provider, b.items]);
  useEffect(() => setMessagePage(0), [selectedId]);
  const shown = ids
    .slice(page * 50, page * 50 + 50)
    .map((id) => itemsById.get(id))
    .filter((c) => c !== undefined);
  async function copy() {
    if (!selected) return;
    const context =
      `UNTRUSTED SOURCE CONTENT\nConversation: ${selected.title}\nProvider: ${selected.provider}\nSource: ${selected.id}\n\n` +
      selected.messages
        .slice(0, 6)
        .map((m) => `[${m.id}] ${m.role}: ${m.text.slice(0, 1500)}`)
        .join("\n\n");
    try {
      await navigator.clipboard.writeText(context);
      b.setNotice(messages.untrusted + " Context copied.");
    } catch {
      b.report("CLIPBOARD");
    }
  }
  return (
    <>
      <SectionHeading
        eyebrow="Workspace / Retrieval"
        title="Knowledge Library"
        description="Imported conversations are sources. Curated Markdown notes belong to the separate vault collection."
      />
      <Collections active="local" />
      {b.sessionIds.size ? (
        <div className="nb-banner" role="status">
          {b.sessionIds.size} conversations are available in this tab only. They
          disappear when you close it.
        </div>
      ) : null}
      {b.total > b.stored.length ? (
        <div className="nb-banner" data-state="partial">
          Searching the loaded {b.stored.length.toLocaleString()} of{" "}
          {b.total.toLocaleString()} stored conversations.
        </div>
      ) : null}
      <div className={"nb-library-grid " + (selected ? "has-selection" : "")}>
        <section
          className="nb-panel nb-library-list"
          aria-label="Conversation library"
        >
          <div className="nb-panel-body">
            <div className="nb-search">
              <Search size={16} />
              <input
                data-testid="nb-library-search"
                aria-label="Search local conversations"
                placeholder="Search titles and messages"
                value={b.libraryQuery}
                onChange={(e) => b.setLibraryQuery(e.target.value)}
              />
            </div>
            <div className="nb-library-filter">
              <label className="nb-field">
                Provider
                <select
                  aria-label="Filter library provider"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                >
                  <option value="">All providers</option>
                  {["chatgpt", "claude", "gemini", "generic"].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <OriginChip origin="local" />
            </div>
            <p className="nb-helper" role="status">
              {progress ||
                `${ids.length.toLocaleString()} matches · nothing sent anywhere`}
            </p>
          </div>
          {b.loading ? (
            <StateSurface state="loading" title="Opening browser archive…" />
          ) : !b.items.length ? (
            <StateSurface
              title="Your archive is empty"
              description="Import a conversation JSON file to begin."
            >
              <Link className="nb-button" href="/sources?tab=imports">
                Import an archive
              </Link>
            </StateSurface>
          ) : (
            <>
              <ul
                className="nb-conversation-list"
                data-testid="nb-conversation-list"
              >
                {shown.map((c, i) => (
                  <li
                    key={c.id}
                    aria-posinset={page * 50 + i + 1}
                    aria-setsize={ids.length}
                    data-testid="nb-card-conversation"
                    data-origin="local"
                  >
                    <Link
                      className="nb-memory-row"
                      href={"/library/local/" + encodeURIComponent(c.id)}
                      prefetch={false}
                      aria-current={selectedId === c.id ? "page" : undefined}
                    >
                      <span className="nb-row-icon">
                        <MessageSquare size={16} />
                      </span>
                      <span className="nb-memory-row-copy">
                        <strong>{neutralizeBidi(c.title)}</strong>
                        <span>
                          {c.provider} · {c.messages.length} messages{" "}
                          {b.sessionIds.has(c.id) ? "· Session only" : ""}
                        </span>
                      </span>
                      <ChevronRight size={14} />
                    </Link>
                  </li>
                ))}
              </ul>
              {!ids.length && !progress ? (
                <StateSurface
                  title="No local matches"
                  description="Nothing was sent anywhere. Try a different title or phrase."
                />
              ) : null}
              <div className="nb-library-pages">
                <p className="nb-helper">
                  Showing {ids.length ? page * 50 + 1 : 0}–
                  {Math.min(ids.length, page * 50 + 50)} of{" "}
                  {ids.length.toLocaleString()}
                </p>
                <div className="nb-actions">
                  <button
                    className="nb-button"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </button>
                  <button
                    className="nb-button"
                    disabled={(page + 1) * 50 >= ids.length}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next 50
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
        <section
          className="nb-panel nb-library-detail"
          aria-label="Conversation reader"
        >
          {selected ? (
            <>
              <div className="nb-note-reader">
                <Link
                  className="nb-button link nb-library-back"
                  href="/library"
                >
                  <ArrowLeft size={15} />
                  Back to archive
                </Link>
                <OriginChip origin="local" />
                <h2 className="nb-read-title">
                  {neutralizeBidi(selected.title)}
                </h2>
                <p className="nb-helper">
                  {selected.provider} · {selected.messages.length} messages ·{" "}
                  {b.sessionIds.has(selected.id)
                    ? "Available in this tab only"
                    : "Stored in this browser"}
                </p>
                <div className="nb-actions">
                  <button
                    className="nb-button"
                    data-testid="nb-copy-context"
                    onClick={() => void copy()}
                  >
                    <Copy size={15} />
                    Copy cited context
                  </button>
                  <Link
                    className="nb-button"
                    href={"/graph?focus=" + encodeURIComponent(selected.id)}
                  >
                    <Network size={15} />
                    Open in graph
                  </Link>
                  <button
                    className="nb-icon-button"
                    aria-label="Delete this conversation"
                    onClick={() => setConfirm(true)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <p className="nb-helper">{messages.untrusted}</p>
                <dl className="nb-metadata">
                  <dt>Source ID</dt>
                  <dd>
                    <code>{selected.id}</code>
                  </dd>
                  <dt>Topic</dt>
                  <dd>
                    {b.analysis?.byId[selected.id] ?? "Not classified"} ·
                    rule-based
                  </dd>
                </dl>
              </div>
              <div className="nb-message-list">
                {selected.messages
                  .slice(messagePage * 10, messagePage * 10 + 10)
                  .map((m) => (
                    <article className="nb-message" key={m.id}>
                      <div className="nb-message-head">
                        <strong>
                          {m.role === "user"
                            ? "You"
                            : m.role === "assistant"
                              ? selected.provider
                              : "Other"}
                        </strong>
                        <code>{m.id}</code>
                      </div>
                      <div className="nb-message-text">
                        {neutralizeBidi(m.text.slice(0, 50000))}
                      </div>
                      {m.text.length > 50000 ? (
                        <p className="nb-helper">
                          Long message preview limited to 50,000 characters. The
                          full original remains in the local export.
                        </p>
                      ) : null}
                    </article>
                  ))}
              </div>
              <div className="nb-library-pages">
                <p className="nb-helper">
                  Messages {messagePage * 10 + 1}–
                  {Math.min(selected.messages.length, messagePage * 10 + 10)} of{" "}
                  {selected.messages.length}
                </p>
                <div className="nb-actions">
                  <button
                    className="nb-button"
                    disabled={messagePage === 0}
                    onClick={() => setMessagePage((p) => p - 1)}
                  >
                    Earlier
                  </button>
                  <button
                    className="nb-button"
                    disabled={
                      (messagePage + 1) * 10 >= selected.messages.length
                    }
                    onClick={() => setMessagePage((p) => p + 1)}
                  >
                    Later
                  </button>
                </div>
              </div>
            </>
          ) : (
            <StateSurface
              title="Follow the source"
              description="Choose a conversation to inspect its messages, copy cited context, or explore its graph connections."
            />
          )}
        </section>
      </div>
      <ConfirmDelete
        open={confirm}
        onClose={() => setConfirm(false)}
        count={1}
        all={false}
        onConfirm={async () => {
          if (selected) {
            await b.remove([selected.id]);
            router.push("/library");
          }
        }}
      />
    </>
  );
}
function VaultLibrary({ demo }: { demo: boolean }) {
  return (
    <>
      <SectionHeading
        eyebrow="Workspace / Curated knowledge"
        title="Knowledge Library"
        description="Markdown notes, explicit provenance, and owner-controlled verification."
      />
      <Collections active="vault" />
      {demo ? (
        <>
          <div className="nb-demo-banner">
            <FlaskConical size={16} />
            {messages.demo}
          </div>
          <section className="nb-panel">
            {DEMO_NOTES.map((n) => (
              <Link
                key={n.noteId}
                className="nb-row"
                href={"/library/note/" + n.noteId + "?demo=1"}
                prefetch={false}
                data-origin="demo"
              >
                <FileText size={18} />
                <div>
                  <strong>{n.title}</strong>
                  <small>
                    {n.type} · revision {n.revision} · Synthetic example
                  </small>
                </div>
                <ChevronRight size={16} />
              </Link>
            ))}
          </section>
        </>
      ) : (
        <StateSurface
          state="unavailable"
          title="Private vault is not connected"
          description="No published notes are available to this browser. A separately approved gateway and owner authorization are required."
        >
          <Link className="nb-button" href="/library?collection=vault&demo=1">
            <FlaskConical size={15} />
            Preview with demo notes
          </Link>
        </StateSurface>
      )}
    </>
  );
}
export function NoteReader({
  id,
  demo,
  tab = "read",
}: {
  id: string;
  demo: boolean;
  tab?: string;
}) {
  const brain = useBrain(),
    note = demo ? DEMO_NOTES.find((n) => n.noteId === id) : undefined,
    [summary, setSummary] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const draft = brain.drafts[id] ?? note?.body ?? "",
    setDraft = (body: string) => brain.setDraft(id, body);
  useEffect(() => {
    if (!note || draft === note.body) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [draft, note]);
  if (!note)
    return (
      <>
        <SectionHeading
          title="Vault note"
          description="Private published content requires an authorized backend connection."
        />
        <StateSurface
          state="unavailable"
          title="Note unavailable"
          description="This browser cannot retrieve the private vault. No note content is inferred or fabricated."
        />
      </>
    );
  const active = ["read", "edit", "revisions", "provenance"].includes(tab)
    ? tab
    : "read";
  function insert(before: string, after = before) {
    const el = textarea.current;
    if (!el) return;
    el.setRangeText(
      before + el.value.slice(el.selectionStart, el.selectionEnd) + after,
      el.selectionStart,
      el.selectionEnd,
      "select",
    );
    setDraft(el.value);
    el.focus();
  }
  return (
    <>
      <div className="nb-demo-banner">
        <FlaskConical size={16} />
        {messages.demo}
      </div>
      <SectionHeading
        title={note.title}
        eyebrow="Synthetic vault note"
        description="Read-only demonstration. File metadata is self-reported and never establishes trust."
        action={
          <Link className="nb-button" href={"/graph?demo=1&focus=" + id}>
            <Network size={15} />
            Open in graph
          </Link>
        }
      />
      <div className="nb-actions nb-section">
        <StatusBadge status="trust.proposed" />
        <OriginChip origin="demo" />
        <span className="nb-helper">
          No owner decision recorded. Revision {note.revision} is synthetic.
        </span>
      </div>
      <nav className="nb-tabs" aria-label="Note sections">
        {["read", "edit", "revisions", "provenance"].map((t) => (
          <Link
            className="nb-tab"
            key={t}
            href={"/library/note/" + id + "?demo=1&tab=" + t}
            aria-current={active === t ? "page" : undefined}
          >
            {t[0]!.toUpperCase() + t.slice(1)}
          </Link>
        ))}
      </nav>
      <section className="nb-panel nb-note-reader">
        {active === "read" ? (
          <SafeMarkdown
            source={note.body}
            resolveWikilink={(title) =>
              DEMO_NOTES.find((n) => n.title === title)?.noteId ?? null
            }
          />
        ) : null}
        {active === "edit" ? (
          <div className="nb-editor" data-testid="nb-editor">
            <div className="nb-toolbar" aria-label="Markdown formatting">
              {(
                [
                  ["Bold", "**", "**"],
                  ["Italic", "_", "_"],
                  ["Heading", "## ", ""],
                  ["List", "- ", ""],
                  ["Link", "[", "](https://example.invalid)"],
                  ["Wikilink", "[[", "]]"],
                  ["Code", "`", "`"],
                ] as const
              ).map(([label, a, c]) => (
                <button
                  className="nb-button"
                  key={label}
                  onClick={() => insert(a, c)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="nb-editor-grid">
              <div>
                <label className="nb-field">
                  Markdown source
                  <textarea
                    ref={textarea}
                    data-testid="nb-editor-body"
                    aria-label="Markdown source"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    maxLength={200000}
                    autoCapitalize="off"
                    spellCheck
                    onKeyDown={(e) => {
                      if (
                        (e.ctrlKey || e.metaKey) &&
                        ["b", "i"].includes(e.key.toLowerCase())
                      ) {
                        e.preventDefault();
                        insert(e.key.toLowerCase() === "b" ? "**" : "_");
                      }
                    }}
                  />
                </label>
                <label className="nb-field">
                  Summary of change
                  <input
                    maxLength={200}
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                  />
                </label>
              </div>
              <div>
                <h3>Safe preview</h3>
                <SafeMarkdown
                  source={draft}
                  resolveWikilink={(title) =>
                    DEMO_NOTES.find((n) => n.title === title)?.noteId ?? null
                  }
                />
              </div>
            </div>
            <TruthfulButton
              id="propose-edit"
              reason="This browser has no approved vault write path. This draft stays in the tab and is not sent or published."
            >
              Propose edit
            </TruthfulButton>
          </div>
        ) : null}
        {active === "revisions" ? (
          <StateSurface
            state="unavailable"
            title="Revision history unavailable"
            description="No backend history was requested. The demonstration revision is illustrative only."
          />
        ) : null}
        {active === "provenance" ? (
          <div data-testid="nb-provenance">
            <h2>Source evidence</h2>
            <p>
              Suggested content. No owner verification decision is recorded.
            </p>
            {note.evidence.map((e, i) => (
              <section key={i}>
                <StatusBadge status="trust.proposed" />
                <dl className="nb-metadata">
                  <dt>Source kind</dt>
                  <dd>{e.kind}</dd>
                  <dt>Provider</dt>
                  <dd>{e.provider ?? "Not reported by the backend"}</dd>
                  <dt>Source</dt>
                  <dd>
                    <code>{e.sourceId}</code>
                  </dd>
                  <dt>Message</dt>
                  <dd>
                    <code>{e.messageId ?? "Not reported by the backend"}</code>
                  </dd>
                  <dt>Consent</dt>
                  <dd>{e.consent ?? "unknown"}</dd>
                  <dt>Availability</dt>
                  <dd>
                    Source not in this browser · archived synthetic reference
                  </dd>
                </dl>
              </section>
            ))}
            <h3>Self-reported metadata</h3>
            <dl className="nb-metadata">
              {Object.entries(note.selfReported).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{Array.isArray(v) ? v.join(", ") : v}</dd>
                </div>
              ))}
            </dl>
            <p className="nb-helper">
              <Shield size={14} /> Self-reported state does not grant
              verification or permissions.
            </p>
          </div>
        ) : null}
      </section>
    </>
  );
}
