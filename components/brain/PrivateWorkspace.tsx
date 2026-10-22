"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { usePrivateMemory } from "./PrivateMemoryProvider";
import {
  SectionHeading,
  StateSurface,
  StatusBadge,
  OriginChip,
} from "./Primitives";
import { SafeMarkdown } from "./SafeMarkdown";
import { GraphCanvas, type CanvasControls } from "./graph/GraphCanvas";
import { makeScene } from "@/lib/brain/graph-scene";
import type {
  DataEnvelope,
  NoteSummary,
  NoteDetail,
  Page,
  Proposal,
  GraphNode,
  GraphEdge,
  ReviewReceipt,
  AgentPrincipal,
} from "@/lib/brain/types";
function State({ value }: { value: DataEnvelope<unknown> | null }) {
  const text = !value
    ? "Requesting private memory…"
    : value.state === "error"
      ? value.error.message
      : value.state === "unavailable"
        ? "Private memory is disconnected. Reconnect in Settings."
        : value.state === "empty"
          ? "No results."
          : "";
  return text ? <p role="status">{text}</p> : null;
}
export function PrivateConnectionSettings() {
  const p = usePrivateMemory(),
    [allowed, setAllowed] = useState(false),
    [working, setWorking] = useState(false);
  if (!p.configured) return null;
  const run = (fn: () => Promise<unknown>) => {
    setWorking(true);
    void fn().finally(() => setWorking(false));
  };
  return (
    <section className="nb-section" aria-label="Private memory connection">
      <h3>Private memory</h3>
      <p>
        Read the private vault and submit proposals through the owner gateway.
        Your browser archive stays local. Provider connections and automatic
        synchronization remain off.
      </p>
      <p role="status">
        {p.notice ||
          "Disconnected. Owner login alone does not grant remote memory access."}
      </p>
      <label className="nb-preference-row">
        <input
          type="checkbox"
          checked={allowed}
          onChange={(e) => setAllowed(e.target.checked)}
        />
        Allow remote memory reads and proposals for this owner session
      </label>
      <div className="nb-actions">
        <button
          className="nb-button"
          disabled={!allowed || working}
          onClick={() => run(() => p.consent(true))}
        >
          Grant remote-memory consent
        </button>
        <button
          className="nb-button"
          disabled={working}
          onClick={() => run(p.connect)}
        >
          Connect to private memory
        </button>
        <button
          className="nb-button"
          disabled={working}
          onClick={() => run(() => p.consent(false))}
        >
          Revoke remote-memory consent
        </button>
        <button className="nb-button" onClick={p.disconnect}>
          Disconnect this tab
        </button>
      </div>
    </section>
  );
}
function ConnectionPrompt() {
  return (
    <StateSurface
      state="unavailable"
      title="Private memory disconnected"
      description="Connect explicitly in Settings after owner login and remote-memory consent."
    >
      <Link className="nb-button" href="/settings?tab=sync">
        Open private connection settings
      </Link>
    </StateSurface>
  );
}
export function RemoteLibrary() {
  const p = usePrivateMemory(),
    [result, setResult] = useState<DataEnvelope<Page<NoteSummary>> | null>(
      null,
    ),
    [cursor, setCursor] = useState<string | undefined>(),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setResult(null);
    if (!p.connected) return;
    const c = new AbortController();
    void p.adapter.port.listNotes({ limit: 25, cursor }, c.signal).then((r) => {
      if (!c.signal.aborted) setResult(r);
    });
    return () => c.abort();
  }, [p.connected, p.version, p.adapter, cursor, refresh]);
  const data =
    result && (result.state === "ready" || result.state === "partial")
      ? result.data
      : null;
  return (
    <>
      <SectionHeading
        title="Private vault notes"
        description="Only acknowledged Markdown revisions are returned. Pending publications remain separate."
      />
      {!p.connected ? (
        <ConnectionPrompt />
      ) : (
        <>
          <State value={result} />
          <button
            className="nb-button"
            onClick={() => {
              setCursor(undefined);
              setRefresh((n) => n + 1);
            }}
          >
            Refresh notes
          </button>
          {data?.items.map((n) => (
            <article className="nb-panel nb-panel-body" key={n.noteId}>
              <OriginChip origin="remote" confirmedAt={result?.confirmedAt} />
              <StatusBadge
                status={
                  n.trust === "verified" ? "trust.verified" : "trust.proposed"
                }
              />
              <h2>
                <Link href={"/library/note/" + n.noteId}>{n.title}</Link>
              </h2>
              <p>
                Revision {n.revision} ·{" "}
                {n.publication === "pub.pending"
                  ? "New publication pending"
                  : "Publication confirmed"}
              </p>
            </article>
          ))}
          {data && !data.items.length ? (
            <p role="status">No published notes.</p>
          ) : null}
          {data?.nextCursor ? (
            <button
              className="nb-button"
              onClick={() => setCursor(data.nextCursor)}
            >
              Next notes
            </button>
          ) : null}
        </>
      )}
    </>
  );
}
export function RemoteNote({ id }: { id: string }) {
  const p = usePrivateMemory(),
    [value, setValue] = useState<DataEnvelope<NoteDetail> | null>(null),
    [draft, setDraft] = useState(""),
    [receipt, setReceipt] = useState<DataEnvelope<ReviewReceipt> | null>(null),
    key = useRef<string>("");
  useEffect(() => {
    setValue(null);
    setDraft("");
    if (!p.connected) return;
    const c = new AbortController();
    void p.adapter.port.getNote(id, c.signal).then((r) => {
      if (c.signal.aborted) return;
      setValue(r);
      if (r.state === "ready") setDraft(r.data.body);
    });
    return () => c.abort();
  }, [id, p.connected, p.version, p.adapter]);
  const n =
    value && (value.state === "ready" || value.state === "partial")
      ? value.data
      : null;
  return (
    <>
      <SectionHeading
        title={n?.title ?? "Private vault note"}
        description="File metadata and note text remain untrusted. SQL owner review establishes verification."
      />
      {!p.connected ? (
        <ConnectionPrompt />
      ) : (
        <>
          <State value={value} />
          {n ? (
            <>
              <OriginChip origin="remote" confirmedAt={value?.confirmedAt} />
              <StatusBadge
                status={
                  n.trust === "verified" ? "trust.verified" : "trust.proposed"
                }
              />
              <SafeMarkdown source={n.body} resolveWikilink={() => null} />
              <h2>Evidence</h2>
              <ul>
                {n.evidence.map((e, i) => (
                  <li key={i}>
                    {e.kind}: {e.sourceId}
                    {e.messageId ? " / " + e.messageId : ""} — source resolution
                    unknown
                  </li>
                ))}
              </ul>
              <label className="nb-field">
                Propose a new revision
                <textarea
                  value={draft}
                  maxLength={180000}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    key.current = "";
                  }}
                />
              </label>
              <button
                className="nb-button"
                disabled={draft === n.body}
                onClick={() => {
                  key.current ||= crypto.randomUUID();
                  void p.adapter
                    .proposeEdit(id, draft, key.current)
                    .then(setReceipt);
                }}
              >
                Submit proposal
              </button>
              {receipt ? (
                <p role="status">
                  {receipt.state === "ready"
                    ? "Proposal received. Owner review is required."
                    : "Proposal acknowledgement is uncertain; retry with the same submission."}
                </p>
              ) : null}
              <Link className="nb-button" href={"/graph?remote=1&focus=" + id}>
                Inspect private graph
              </Link>
            </>
          ) : null}
        </>
      )}
    </>
  );
}
export function RemoteReview() {
  const p = usePrivateMemory(),
    params = useSearchParams(),
    challenge = params.get("review"),
    [value, setValue] = useState<DataEnvelope<Page<Proposal>> | null>(null),
    [cursor, setCursor] = useState<string | undefined>(),
    [notice, setNotice] = useState(""),
    [refresh, setRefresh] = useState(0),
    [challengeState, setChallengeState] = useState(""),
    [confirmation, setConfirmation] = useState<ReviewReceipt | null>(null),
    [working, setWorking] = useState(false);
  useEffect(() => {
    setValue(null);
    setChallengeState("");
    setConfirmation(null);
    if (!p.connected) return;
    const c = new AbortController();
    void p.adapter.port
      .listProposals({ limit: 25, cursor }, c.signal)
      .then((r) => {
        if (!c.signal.aborted) setValue(r);
      });
    if (challenge)
      void p.adapter.receipt(challenge).then((r) => {
        if (!c.signal.aborted && r.state === "ready") {
          setChallengeState(r.data.state ?? "");
          setConfirmation(r.data);
        }
      });
    return () => c.abort();
  }, [p.connected, p.version, p.adapter, cursor, refresh, challenge]);
  const data =
    value && (value.state === "ready" || value.state === "partial")
      ? value.data
      : null;
  async function review(id: string, decision: "verify" | "reject") {
    setWorking(true);
    try {
      const r = await p.adapter.port.review(id, decision);
      if (r.state !== "ready" || !r.data.challengeId) {
        setNotice("Review challenge could not be created.");
        return;
      }
      const start = await p.adapter.start(r.data.challengeId);
      if (start.state === "ready") location.assign(start.data.authorizationUrl);
      else
        setNotice(
          "Fresh Google authentication is unavailable. The proposal is unchanged.",
        );
    } finally {
      setWorking(false);
    }
  }
  return (
    <>
      <SectionHeading
        title="Owner review queue"
        action={<Link className="nb-button" href="/agents?tab=identities">Private identity registry</Link>}
        description="Each decision requires fresh Google authentication followed by explicit confirmation. Agents cannot approve memories."
      />
      {!p.connected ? (
        <ConnectionPrompt />
      ) : (
        <>
          <State value={value} />
          <p role="status">{notice}</p>
          {challenge && challengeState === "confirmation-required" ? (
            <div className="nb-panel nb-panel-body">
              <h2>Confirm authenticated decision</h2>
              <p>
                {confirmation?.decision} · proposal {confirmation?.subjectId} ·
                base revision {confirmation?.expectedRevision}
              </p>
              {confirmation?.preview ? (
                <>
                  <h3>{confirmation.preview.title}</h3>
                  <SafeMarkdown
                    source={confirmation.preview.body}
                    resolveWikilink={() => null}
                  />
                </>
              ) : null}
              <p>
                Intent: <code>{confirmation?.intentSha256}</code>
              </p>
              <p>
                Complete only the exact decision you initiated. Publication
                remains pending until the private worker acknowledges the
                Markdown revision.
              </p>
              <button
                className="nb-button"
                disabled={working}
                onClick={() => {
                  setWorking(true);
                  void p.adapter
                    .complete(challenge)
                    .then((r) => {
                      setNotice(
                        r.state === "ready"
                          ? r.data.state === "pending"
                            ? "Decision recorded. Markdown publication pending."
                            : "Decision confirmed."
                          : "Decision acknowledgement is uncertain. Check receipt before retrying.",
                      );
                      setRefresh((n) => n + 1);
                    })
                    .finally(() => setWorking(false));
                }}
              >
                Confirm owner decision
              </button>
            </div>
          ) : null}
          <button
            className="nb-button"
            onClick={() => {
              setCursor(undefined);
              setRefresh((n) => n + 1);
            }}
          >
            Refresh review queue
          </button>
          {data?.items.map((item) => (
            <article className="nb-panel nb-panel-body" key={item.id}>
              <OriginChip origin="remote" confirmedAt={value?.confirmedAt} />
              <h2>{item.title}</h2>
              <p>
                {item.agent.displayName} · {item.agent.role} · base revision{" "}
                {item.baseRevision}
              </p>
              <SafeMarkdown
                source={item.body ?? ""}
                resolveWikilink={() => null}
              />
              <p>
                {item.evidence.length} evidence references; raw source
                resolution unknown.
              </p>
              <div className="nb-actions">
                <button
                  className="nb-button"
                  disabled={working}
                  onClick={() => void review(item.id, "verify")}
                >
                  Verify with fresh Google authentication
                </button>
                <button
                  className="nb-button"
                  disabled={working}
                  onClick={() => void review(item.id, "reject")}
                >
                  Reject with fresh Google authentication
                </button>
              </div>
            </article>
          ))}
          {data?.nextCursor ? (
            <button
              className="nb-button"
              onClick={() => setCursor(data.nextCursor)}
            >
              Next proposals
            </button>
          ) : null}
        </>
      )}
    </>
  );
}
export function RemoteGraph({ focus }: { focus?: string }) {
  const p = usePrivateMemory(),
    router = useRouter(),
    [value, setValue] = useState<DataEnvelope<{
      nodes: GraphNode[];
      edges: GraphEdge[];
    }> | null>(null),
    [selected, setSelected] = useState<string | null>(focus ?? null),
    [depth, setDepth] = useState<1 | 2 | 3>(1),
    controls = useRef<CanvasControls | null>(null);
  useEffect(() => {
    setValue(null);
    if (!p.connected) return;
    const c = new AbortController();
    void p.adapter.port
      .graph({ focus, depth, limit: 150 }, c.signal)
      .then((r) => {
        if (!c.signal.aborted) setValue(r);
      });
    return () => c.abort();
  }, [p.connected, p.version, p.adapter, focus, depth]);
  const data =
    value && (value.state === "ready" || value.state === "partial")
      ? value.data
      : null;
  const scene = useMemo(() => {
    if (!data) return null;
    const positions = new Float32Array(data.nodes.length * 2);
    data.nodes.forEach((_, i) => {
      const angle = (2 * Math.PI * i) / Math.max(1, data.nodes.length);
      positions[i * 2] = Math.cos(angle) * 250;
      positions[i * 2 + 1] = Math.sin(angle) * 250;
    });
    return makeScene(
      {
        nodes: data.nodes,
        edges: data.edges,
        loadedSources: 0,
        totalSources: 0,
        partial: value?.state === "partial",
      },
      positions,
      data.nodes,
      data.edges,
    );
  }, [data, value?.state]);
  return (
    <>
      <SectionHeading
        title="Private evidence graph"
        description="Bounded SQL relations from acknowledged revisions. This graph is separate from the local archive graph."
      />
      {!p.connected ? (
        <ConnectionPrompt />
      ) : (
        <>
          <State value={value} />
          <label className="nb-field">
            Neighborhood depth
            <select
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value) as 1 | 2 | 3)}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>
          {value?.state === "partial" ? (
            <p role="status">
              Partial graph. Focus a note to explore its neighborhood.
            </p>
          ) : null}
          {scene && data ? (
            <>
              <div className="nb-private-graph">
                <GraphCanvas
                  scene={scene}
                  selected={selected}
                  onSelect={setSelected}
                  onExpand={() => setDepth(2)}
                  onFocus={() => {
                    if (selected)
                      router.push("/graph?remote=1&focus=" + selected);
                  }}
                  onList={() =>
                    document.getElementById("private-graph-list")?.focus()
                  }
                  controls={controls}
                />
              </div>
              <ul id="private-graph-list" tabIndex={-1}>
                {data.nodes.map((n) => (
                  <li key={n.id}>
                    <Link href={"/library/note/" + n.id}>{n.label}</Link> ·{" "}
                    {n.trust}
                    <Link
                      className="nb-button"
                      href={"/graph?remote=1&focus=" + n.id}
                    >
                      Focus
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </>
  );
}

export function RemoteRegistry() {
  const p = usePrivateMemory(),
    [value, setValue] = useState<DataEnvelope<AgentPrincipal[]> | null>(null);
  useEffect(() => {
    setValue(null);
    if (!p.connected) return;
    const c = new AbortController();
    void p.adapter.port.listAgents(c.signal).then((r) => {
      if (!c.signal.aborted) setValue(r);
    });
    return () => c.abort();
  }, [p.connected, p.version, p.adapter]);
  const agents =
    value && (value.state === "ready" || value.state === "partial")
      ? value.data
      : null;
  return (
    <>
      <SectionHeading
        title="Private identity registry"
        action={<Link className="nb-button" href="/agents">Owner review queue</Link>}
        description="Owner identities and scoped synthetic agents have separate authority. No real provider is connected."
      />
      {!p.connected ? (
        <ConnectionPrompt />
      ) : (
        <>
          <State value={value} />
          {agents?.map((a) => (
            <article className="nb-panel nb-panel-body" key={a.agentId}>
              <h2>{a.displayName}</h2>
              <p>
                {a.kind === "owner" ? "Owner identity" : "Synthetic agent"} ·{" "}
                {a.role}
              </p>
              <p>Scopes: {a.scopes.join(", ")}</p>
              <p>
                {a.disabledAt
                  ? "Revoked"
                  : a.expiresAt
                    ? "Credential expires " + a.expiresAt
                    : "Owner session required"}
              </p>
            </article>
          ))}
        </>
      )}
    </>
  );
}
