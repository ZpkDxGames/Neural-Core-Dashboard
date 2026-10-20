"use client";
import Link from "next/link";
import { useRef, useState, useEffect } from "react";
import { FileUp, Download, Trash2, FolderInput, Shield } from "lucide-react";
import { useBrain, type Preview } from "./BrainProvider";
import {
  SectionHeading,
  OriginChip,
  ConfirmDelete,
  StateSurface,
  StatusBadge,
} from "./Primitives";
import { messages } from "@/lib/brain/messages";
import { neutralizeBidi } from "@/lib/brain/links";
export function DataActions() {
  const b = useBrain(),
    [confirm, setConfirm] = useState(false);
  return (
    <>
      <div className="nb-actions">
        <button
          className="nb-button"
          data-testid="nb-export"
          onClick={() => void b.exportLocal()}
        >
          <Download size={16} />
          Export local JSON
        </button>
        <button
          className="nb-button danger"
          data-testid="nb-delete-open"
          disabled={!b.total}
          onClick={() => setConfirm(true)}
        >
          <Trash2 size={16} />
          Delete browser data
        </button>
      </div>
      <p className="nb-helper">{messages.deletion}</p>
      <p className="nb-helper">{messages.remoteDeletion}</p>
      <ConfirmDelete
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => b.remove(null)}
        count={b.total}
      />
    </>
  );
}
export function Sources({ tab = "archives" }: { tab?: string }) {
  const b = useBrain(),
    [state, setState] = useState<
      | "choose"
      | "parsing"
      | "preview"
      | "saving"
      | "saved"
      | "declined"
      | "error"
    >("choose"),
    [preview, setPreview] = useState<Preview | null>(null),
    [fileName, setFileName] = useState(""),
    [code, setCode] = useState("");
  const worker = useRef<Worker | null>(null),
    generation = useRef(0),
    deadline = useRef<ReturnType<typeof setTimeout> | null>(null),
    input = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      worker.current?.terminate();
      if (deadline.current) clearTimeout(deadline.current);
      generation.current++;
    },
    [],
  );
  function cancel() {
    if (deadline.current) clearTimeout(deadline.current);
    generation.current++;
    worker.current?.terminate();
    worker.current = null;
    setState("choose");
    setPreview(null);
  }
  function parse(file: File) {
    if (deadline.current) clearTimeout(deadline.current);
    worker.current?.terminate();
    const seq = ++generation.current;
    setFileName(neutralizeBidi(file.name));
    setPreview(null);
    setCode("");
    if (file.size > 32 * 1024 * 1024) {
      setCode("FILE_TOO_LARGE");
      setState("error");
      return;
    }
    setState("parsing");
    const next = new Worker(
      new URL("../../lib/brain/archive.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = next;
    deadline.current = setTimeout(() => {
      if (seq === generation.current) {
        next.terminate();
        setCode("PARSER_TIMEOUT");
        setState("error");
      }
    }, 15000);
    next.onmessage = (e) => {
      if (deadline.current) clearTimeout(deadline.current);
      if (seq !== generation.current) return;
      next.terminate();
      if (e.data.ok) {
        setPreview(e.data.result as Preview);
        setState("preview");
      } else {
        setCode(e.data.code);
        setState("error");
      }
    };
    next.onerror = () => {
      if (deadline.current) clearTimeout(deadline.current);
      if (seq === generation.current) {
        setCode("PARSER_UNAVAILABLE");
        setState("error");
      }
      next.terminate();
    };
    next.postMessage({ file });
  }
  const storedIds = new Set(b.stored.map((c) => c.id));
  const duplicates = preview
    ? preview.conversations.filter((c) => storedIds.has(c.id)).length
    : 0;
  const countMessages =
    preview?.conversations.reduce((n, c) => n + c.messages.length, 0) ?? 0;
  return (
    <>
      <SectionHeading
        eyebrow="Data / Local archive"
        title="Sources & Imports"
        description="Bring your conversations together. Preview every import before choosing where to keep it."
      />
      <nav className="nb-tabs" aria-label="Source sections">
        {["archives", "imports", "deletion"].map((t) => (
          <Link
            key={t}
            className="nb-tab"
            href={"/sources?tab=" + t}
            aria-current={tab === t ? "page" : undefined}
          >
            {t === "archives"
              ? "Archives"
              : t === "imports"
                ? "Import archive"
                : "Deletion"}
          </Link>
        ))}
      </nav>
      {tab === "deletion" ? (
        <section className="nb-panel nb-panel-body">
          <h2>Delete with a clear boundary</h2>
          <p>
            There are {b.total.toLocaleString()} conversations saved in this
            browser.
          </p>
          <DataActions />
        </section>
      ) : (
        <>
          <div className="nb-provider-grid">
            {[
              {
                id: "chatgpt",
                name: "ChatGPT",
                text: "conversations.json · active conversation branch",
                symbol: "◎",
              },
              {
                id: "claude",
                name: "Claude",
                text: "chats.json · message content blocks",
                symbol: "✳",
              },
              {
                id: "gemini",
                name: "Gemini / Generic",
                text: "Normalized conversation JSON · not Takeout",
                symbol: "◇",
              },
            ].map((p) => (
              <article key={p.id} className="nb-provider" data-origin="local">
                <div className="nb-provider-symbol" aria-hidden="true">
                  {p.symbol}
                </div>
                <h3>{p.name}</h3>
                <p>{p.text}</p>
                <strong className="nb-num">
                  {b.stored
                    .filter((c) =>
                      p.id === "gemini"
                        ? c.provider === "gemini" || c.provider === "generic"
                        : c.provider === p.id,
                    )
                    .length.toLocaleString()}
                </strong>
                <span className="nb-helper"> conversations imported</span>
                <div>
                  <OriginChip origin="local" />
                </div>
              </article>
            ))}
          </div>
          <section
            className="nb-panel nb-panel-body"
            aria-label="Archive importer"
          >
            <div className="nb-section-heading">
              <div>
                <h2>Import a conversation archive</h2>
                <p className="nb-helper">
                  01 Choose file · 02 Preview · 03 Storage consent
                </p>
              </div>
              <FolderInput size={20} />
            </div>
            {state === "choose" || state === "error" ? (
              <div className="nb-import-drop">
                <FileUp size={28} />
                <h2>A private place for your conversations</h2>
                <p>JSON only, up to 32 MB and 50,000 conversations per file.</p>
                <label htmlFor="nb-import-file" className="nb-button">
                  Choose JSON archive
                </label>
                <input
                  id="nb-import-file"
                  ref={input}
                  data-testid="nb-import-file"
                  type="file"
                  accept=".json,application/json"
                  aria-label="Choose JSON archive"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) parse(file);
                    e.target.value = "";
                  }}
                />
                <p className="nb-helper">{messages.gemini}</p>
              </div>
            ) : null}
            {state === "error" ? (
              <div role="alert" className="nb-consent" data-state="error">
                <h3>Archive could not be read</h3>
                <p>
                  {fileName} · <code>{code}</code>
                </p>
                <p>
                  Nothing has been saved. Select a supported conversation JSON
                  export.
                </p>
              </div>
            ) : null}
            {state === "parsing" ? (
              <StateSurface
                state="loading"
                title="Reading archive…"
                description="Parsing happens in a background worker. Nothing has been saved."
              >
                <button
                  className="nb-button"
                  onClick={cancel}
                  data-testid="nb-import-cancel"
                >
                  Cancel import
                </button>
              </StateSurface>
            ) : null}
            {preview &&
            ["preview", "saving", "saved", "declined"].includes(state) ? (
              <>
                <div className="nb-section-heading">
                  <div>
                    <h3>Import preview</h3>
                    <p>{fileName}</p>
                  </div>
                  <OriginChip origin="local" />
                </div>
                <div className="nb-table-scroll">
                  <table>
                    <caption className="nb-sr-only">
                      Archive preview counts
                    </caption>
                    <tbody>
                      {[
                        ["Conversations", preview.conversations.length],
                        ["Messages", countMessages],
                        ["Already in this browser", duplicates],
                        [
                          "New records",
                          preview.conversations.length - duplicates,
                        ],
                        ["Unreadable records skipped", preview.ignored],
                        [
                          "Repeated IDs in this file",
                          preview.duplicatesWithinFile,
                        ],
                      ].map(([label, value]) => (
                        <tr key={label}>
                          <th scope="row">{label}</th>
                          <td className="nb-num">{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="nb-helper">
                  Existing provider-scoped IDs are replaced if you choose to
                  store this import.
                </p>
                {state === "preview" ? (
                  <section
                    className="nb-consent"
                    data-testid="nb-consent-local-storage"
                    data-state="consent-required"
                    aria-label="Storage consent"
                  >
                    <h2>
                      <Shield size={17} /> Choose how to keep this archive
                    </h2>
                    <p>
                      {messages.preview} Save these{" "}
                      {preview.conversations.length} conversations in this
                      browser’s storage so they are still here next time.
                      Nothing is uploaded.
                    </p>
                    <div className="nb-actions">
                      <button
                        className="nb-button"
                        data-testid="nb-consent-grant"
                        onClick={async () => {
                          setState("saving");
                          try {
                            await b.save(preview);
                            setState("saved");
                          } catch {
                            setState("preview");
                          }
                        }}
                      >
                        Store in this browser
                      </button>
                      <button
                        className="nb-button"
                        data-testid="nb-consent-decline"
                        onClick={() => {
                          b.keepInTab(preview);
                          setState("declined");
                        }}
                      >
                        Don’t store
                      </button>
                      <button className="nb-button link" onClick={cancel}>
                        Cancel
                      </button>
                    </div>
                  </section>
                ) : null}
                {state === "saving" ? (
                  <p role="status" aria-busy="true">
                    Saving to this browser…
                  </p>
                ) : null}
                {state === "saved" ? (
                  <div
                    className="nb-consent"
                    data-testid="nb-state-success"
                    data-state="success"
                  >
                    <h2>
                      Saved {preview.conversations.length} conversations to this
                      browser.
                    </h2>
                    <p>Nothing was uploaded.</p>
                    <div className="nb-actions">
                      <Link className="nb-button primary" href="/library">
                        Open library
                      </Link>
                      <button className="nb-button" onClick={cancel}>
                        Import another archive
                      </button>
                    </div>
                  </div>
                ) : null}
                {state === "declined" ? (
                  <div className="nb-consent">
                    <h2>Available in this tab</h2>
                    <p>
                      These conversations will disappear when you close this
                      tab.
                    </p>
                    <Link className="nb-button" href="/library">
                      Browse without storing
                    </Link>
                  </div>
                ) : null}
              </>
            ) : null}
          </section>
          <section
            className="nb-section nb-panel nb-panel-body"
            style={{ marginTop: "var(--nb-sp-6)" }}
          >
            <h2>Local storage and remote synchronization are separate</h2>
            <p className="nb-helper">
              Your browser archive is available here without an account. It can
              be removed by clearing browser data and is not available on other
              devices.
            </p>
            <StatusBadge status="sync.local-only" />
            <p className="nb-helper">
              {messages.remote} An approved private gateway, owner sign-in and
              explicit upload consent are all required before anything can be
              sent.
            </p>
            <DataActions />
          </section>
        </>
      )}
    </>
  );
}
