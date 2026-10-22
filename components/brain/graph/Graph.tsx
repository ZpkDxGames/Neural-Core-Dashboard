"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import {useSearchParams} from "next/navigation";
import {usePrivateMemory} from "../PrivateMemoryProvider";
import {RemoteGraph} from "../PrivateWorkspace";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  SlidersHorizontal,
  Minus,
  Plus,
  Scan,
  FlaskConical,
  Network,
  ArrowUpRight,
  Copy,
  X,
  Pause,
  Play,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  EyeOff,
} from "lucide-react";
import { useBrain } from "../BrainProvider";
import {
  SectionHeading,
  OriginChip,
  StatusBadge,
  StateSurface,
  TruthfulButton,
  Modal,
  announce,
} from "../Primitives";
import { messages } from "@/lib/brain/messages";
import type { Projection, DisplayNode } from "@/lib/brain/graph-data";
import { makeScene } from "@/lib/brain/graph-scene";
import { GraphCanvas, type CanvasControls } from "./GraphCanvas";
const ThreeGraph = dynamic(() => import("./webgl/ThreeGraph"), {
  ssr: false,
  loading: () => <p className="nb-helper">Loading optional 3D renderer…</p>,
});
type Mode = "map" | "neighborhood" | "list" | "hierarchy";
function LocalGraph({
  demo = false,
  focus,
  initialMode = "map",
}: {
  demo?: boolean;
  focus?: string;
  initialMode?: string;
}) {
  const b = useBrain(),
    [result, setResult] = useState<{
      graph: Projection;
      positions: Float32Array;
      layoutMs: number;
    } | null>(null),
    [failed, setFailed] = useState(false),
    [query, setQuery] = useState(""),
    [provider, setProvider] = useState(""),
    [cluster, setCluster] = useState(""),
    [kind, setKind] = useState(""),
    [mode, setMode] = useState<Mode>(
      ["map", "neighborhood", "list", "hierarchy"].includes(initialMode)
        ? (initialMode as Mode)
        : "map",
    ),
    [selectedId, setSelectedId] = useState<string | null>(focus ?? null),
    [focusId, setFocusId] = useState<string | null>(focus ?? null),
    [depth, setDepth] = useState(1),
    [renderer, setRenderer] = useState<"canvas2d" | "webgl">("canvas2d"),
    [graphicsReason, setGraphicsReason] = useState(""),
    [playing, setPlaying] = useState(false),
    [filtersOpen, setFiltersOpen] = useState(false),
    [inspectorOpen, setInspectorOpen] = useState(false),
    [wide, setWide] = useState(false),
    [page, setPage] = useState(0),
    [hidden, setHidden] = useState<Set<string>>(new Set()),
    [hierarchyCluster, setHierarchyCluster] = useState("");
  const controls = useRef<CanvasControls | null>(null);
  useEffect(() => {
    const media = matchMedia("(min-width:1280px)"),
      update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (b.loading && !demo) return;
    setFailed(false);
    setResult(null);
    const worker = new Worker(
        new URL("../../../lib/brain/graph.worker.ts", import.meta.url),
        { type: "module" },
      ),
      deadline = setTimeout(() => {
        worker.terminate();
        setFailed(true);
      }, 10000);
    worker.onmessage = (e) => {
      clearTimeout(deadline);
      if (e.data.ok)
        setResult(
          e.data as {
            graph: Projection;
            positions: Float32Array;
            layoutMs: number;
          },
        );
      else setFailed(true);
      worker.terminate();
    };
    worker.onerror = () => {
      clearTimeout(deadline);
      setFailed(true);
      worker.terminate();
    };
    worker.postMessage({
      items: b.items,
      demo,
      total: Math.max(b.total, b.items.length),
      focus,
    });
    return () => {
      clearTimeout(deadline);
      worker.terminate();
    };
  }, [b.items, b.total, b.loading, demo, focus]);
  const nodes = useMemo(() => {
    if (!result) return [];
    const { graph } = result;
    let included: Set<string> | null = null;
    if (mode === "neighborhood" && focusId) {
      included = new Set([focusId]);
      let frontier = [focusId];
      for (let d = 0; d < depth; d++) {
        const next: string[] = [];
        for (const edge of graph.edges) {
          const id = frontier.includes(edge.source)
            ? edge.target
            : frontier.includes(edge.target)
              ? edge.source
              : null;
          if (id && !included.has(id) && included.size < 300) {
            included.add(id);
            next.push(id);
          }
        }
        frontier = next;
      }
    }
    return graph.nodes.filter(
      (n) =>
        !hidden.has(n.id) &&
        (!query || n.label.toLowerCase().includes(query.toLowerCase())) &&
        (!cluster || n.clusterId === cluster) &&
        (!provider ||
          n.provider === provider ||
          n.kind === "cluster" ||
          n.evidence?.some((e) => e.provider === provider)) &&
        (!kind || n.kind === kind) &&
        (!included || included.has(n.id)),
    );
  }, [result, query, cluster, provider, kind, mode, focusId, depth, hidden]);
  const edges = useMemo(() => {
    if (!result) return [];
    const ids = new Set(nodes.map((n) => n.id));
    return result.graph.edges.filter(
      (e) => ids.has(e.source) && ids.has(e.target),
    );
  }, [result, nodes]);
  const scene = useMemo(
    () =>
      result ? makeScene(result.graph, result.positions, nodes, edges) : null,
    [result, nodes, edges],
  );
  const selected = result?.graph.nodes.find((n) => n.id === selectedId),
    clusters = useMemo(
      () =>
        [...new Set(result?.graph.nodes.map((n) => n.clusterId) ?? [])].sort(),
      [result],
    );
  useEffect(() => setPage(0), [query, cluster, provider, kind, mode, hidden]);
  function select(id: string) {
    setSelectedId(id);
    setInspectorOpen(true);
    const node = result?.graph.nodes.find((n) => n.id === id);
    if (node)
      announce(
        `${node.kind} ${node.label}, ${node.trust}, ${node.degree} connections.`,
      );
  }
  function focusSelected() {
    if (selectedId) {
      setFocusId(selectedId);
      setMode("neighborhood");
      setDepth(1);
    }
  }
  function expand() {
    if (selectedId) {
      setFocusId(selectedId);
      setMode("neighborhood");
      setDepth((d) => Math.min(3, d + 1));
      announce("Neighborhood depth increased, within the loaded graph.");
    }
  }
  function reset() {
    setQuery("");
    setCluster("");
    setProvider("");
    setKind("");
    setHidden(new Set());
    setMode("map");
    setDepth(1);
  }
  function choose3D() {
    if (renderer === "webgl") {
      setRenderer("canvas2d");
      return;
    }
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", {
      failIfMajorPerformanceCaveat: true,
    });
    if (!gl) {
      setGraphicsReason(
        "3D needs hardware graphics. The 2D map and accessible list remain available.",
      );
      announce("3D is unavailable. Using 2D.");
      return;
    }
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    setGraphicsReason("");
    setPlaying(false);
    setRenderer("webgl");
  }
  const inspector = selected ? (
    <GraphInspector
      node={selected}
      graph={result!.graph}
      demo={demo}
      onFocus={focusSelected}
      onExpand={expand}
      onHide={() => {
        setHidden((p) => new Set([...p, selected.id]));
        setSelectedId(null);
        setInspectorOpen(false);
        announce("Hidden from this view. No data was deleted.");
      }}
    />
  ) : null;
  const empty = !demo && !b.loading && !b.items.length;
  const filters = (
    <>
      <label className="nb-field">
        Node kind
        <select
          aria-label="Filter node kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">All kinds</option>
          {["source", "concept", "cluster", "note"].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <label className="nb-field">
        Cluster
        <select
          aria-label="Filter graph cluster"
          value={cluster}
          onChange={(e) => setCluster(e.target.value)}
        >
          <option value="">All clusters</option>
          {clusters.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <label className="nb-field">
        Provider
        <select
          aria-label="Filter graph provider"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        >
          <option value="">All providers</option>
          {["chatgpt", "claude", "gemini", "generic"].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <TruthfulButton id="graph-remote-layer" reason={messages.remote}>
        Remote vault layer
      </TruthfulButton>
      <button className="nb-button" onClick={reset}>
        Reset filters
      </button>
    </>
  );
  return (
    <>
      <SectionHeading
        eyebrow="Workspace / Connected evidence"
        title="Neural Graph"
        description="Follow literal topic mentions and source relationships. A connection is an explanation, not a claim of fact."
        action={
          <div className="nb-actions">
            <OriginChip origin={demo ? "demo" : "local"} />
            <Link className="nb-button" href="/library">
              <ArrowUpRight size={15} />
              Open library
            </Link>
          </div>
        }
      />
      {demo ? (
        <div className="nb-demo-banner" data-testid="nb-demo-banner">
          <FlaskConical size={16} />
          {messages.demo}
        </div>
      ) : null}
      {empty ? (
        <StateSurface
          title="Start with a source"
          description="Import an archive to explore its conversations, or open the clearly labelled synthetic network."
        >
          <div className="nb-actions" style={{ justifyContent: "center" }}>
            <Link className="nb-button primary" href="/sources?tab=imports">
              Import archive
            </Link>
            <Link className="nb-button" href="/graph?demo=1">
              <FlaskConical size={15} />
              Show demo network
            </Link>
          </div>
        </StateSurface>
      ) : failed ? (
        <StateSurface
          state="error"
          title="Graph layout unavailable"
          description="The background layout worker could not complete. You can still use the conversation library."
        >
          <Link href="/library" className="nb-button">
            Open library
          </Link>
        </StateSurface>
      ) : !scene || !result ? (
        <StateSurface
          state="loading"
          title="Arranging the knowledge map…"
          description="Graph layout happens in a background worker."
        />
      ) : (
        <>
          <div className="nb-graph-toolbar" data-testid="nb-graph-toolbar">
            <div className="nb-search">
              <Search size={16} />
              <input
                aria-label="Search graph"
                data-testid="nb-graph-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search loaded nodes"
              />
            </div>
            <div className="nb-graph-modes" aria-label="Graph display mode">
              {(["map", "neighborhood", "hierarchy", "list"] as const).map(
                (m) => (
                  <button
                    className="nb-tab"
                    key={m}
                    data-testid={"nb-graph-mode-" + m}
                    aria-pressed={mode === m}
                    onClick={() => {
                      setMode(m);
                      if (m === "neighborhood" && !focusId)
                        setFocusId(selectedId ?? nodes[0]?.id ?? null);
                    }}
                  >
                    {m === "map"
                      ? "Map"
                      : m === "neighborhood"
                        ? "Neighborhood"
                        : m === "hierarchy"
                          ? "Hierarchy"
                          : "List"}
                  </button>
                ),
              )}
            </div>
            <button
              className="nb-button"
              onClick={() => setFiltersOpen(true)}
              data-testid="nb-graph-filters"
            >
              <SlidersHorizontal size={15} />
              Filters
            </button>
            <button
              className="nb-button"
              onClick={choose3D}
              aria-pressed={renderer === "webgl"}
              data-testid="nb-graph-3d"
            >
              {renderer === "webgl" ? "2D map" : "3D sphere"}
            </button>
            <div className="nb-actions">
              <button
                className="nb-icon-button"
                aria-label="Zoom out"
                onClick={() => controls.current?.zoom(1 / 1.2)}
              >
                <Minus size={16} />
              </button>
              <button
                className="nb-icon-button"
                aria-label="Zoom in"
                onClick={() => controls.current?.zoom(1.2)}
              >
                <Plus size={16} />
              </button>
              <button
                className="nb-icon-button"
                aria-label="Fit graph"
                onClick={() => controls.current?.fit()}
              >
                <Scan size={17} />
              </button>
            </div>
            {renderer === "webgl" ? (
              <button
                className="nb-button"
                onClick={() => setPlaying((p) => !p)}
                aria-label={playing ? "Pause rotation" : "Resume rotation"}
              >
                {playing ? <Pause size={15} /> : <Play size={15} />}Rotation
              </button>
            ) : null}
          </div>
          <div className="nb-graph-status" data-testid="nb-graph-status">
            <span>
              Showing{" "}
              {nodes.filter((n) => n.kind === "source").length.toLocaleString()}{" "}
              of {result.graph.totalSources.toLocaleString()} source
              conversations · {nodes.length.toLocaleString()} nodes ·{" "}
              {edges.length.toLocaleString()} links
            </span>
            <button className="nb-button link" onClick={reset}>
              Reset
            </button>
          </div>
          {result.graph.partial ? (
            <div className="nb-banner" data-state="partial">
              This is a bounded graph window. Search the library to focus a
              conversation beyond this window.
            </div>
          ) : null}
          {graphicsReason ? (
            <div className="nb-banner" role="status">
              {graphicsReason}
            </div>
          ) : null}
          <div
            className={
              "nb-graph-workspace " + (wide && selected ? "with-inspector" : "")
            }
          >
            <section
              className="nb-panel nb-graph-panel"
              data-renderer={renderer}
            >
              {mode === "list" || mode === "hierarchy" ? (
                <div
                  className="nb-graph-dom"
                  data-testid={
                    mode === "list" ? "nb-graph-list" : "nb-graph-tree"
                  }
                >
                  {mode === "hierarchy" ? (
                    <div className="nb-cluster-groups">
                      {clusters.map((name) => (
                        <button
                          className="nb-button"
                          key={name}
                          aria-expanded={hierarchyCluster === name}
                          onClick={() => {
                            setHierarchyCluster((p) =>
                              p === name ? "" : name,
                            );
                            setPage(0);
                          }}
                        >
                          {name} ·{" "}
                          {nodes.filter((n) => n.clusterId === name).length}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <ul className="nb-conversation-list">
                    {nodes
                      .filter(
                        (n) =>
                          mode !== "hierarchy" ||
                          !hierarchyCluster ||
                          n.clusterId === hierarchyCluster,
                      )
                      .slice(page * 50, page * 50 + 50)
                      .map((n, i) => (
                        <li
                          key={n.id}
                          aria-setsize={nodes.length}
                          aria-posinset={page * 50 + i + 1}
                        >
                          <button
                            className="nb-graph-list-row"
                            onClick={() => select(n.id)}
                            data-testid="nb-graph-node"
                          >
                            <span className="nb-memory-row-copy">
                              <strong>{n.label}</strong>
                              <span>
                                {n.kind} · {n.clusterId} · {n.degree}{" "}
                                connections
                              </span>
                            </span>
                            <StatusBadge
                              status={
                                n.trust === "proposed"
                                  ? "trust.proposed"
                                  : "trust.heuristic"
                              }
                            />
                          </button>
                        </li>
                      ))}
                  </ul>
                  <div className="nb-library-pages">
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
                        disabled={
                          (page + 1) * 50 >=
                          nodes.filter(
                            (n) =>
                              mode !== "hierarchy" ||
                              !hierarchyCluster ||
                              n.clusterId === hierarchyCluster,
                          ).length
                        }
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Next 50
                      </button>
                    </div>
                  </div>
                </div>
              ) : renderer === "webgl" ? (
                <ThreeGraph
                  key={b.prefs.theme + ":" + b.prefs.motion}
                  scene={scene}
                  selected={selectedId}
                  controls={controls}
                  playing={playing && b.prefs.motion !== "reduce"}
                  onSelect={select}
                  onFallback={() => {
                    setRenderer("canvas2d");
                    setGraphicsReason(
                      "Graphics paused. Switched to 2D while preserving selection.",
                    );
                  }}
                />
              ) : (
                <GraphCanvas
                  scene={scene}
                  selected={selectedId}
                  onSelect={select}
                  onExpand={expand}
                  onFocus={focusSelected}
                  onList={() => setMode("list")}
                  controls={controls}
                />
              )}
              <div className="nb-graph-footer">
                <div>
                  <span aria-hidden="true">◇</span> Concepts ·{" "}
                  <span aria-hidden="true">□</span> Sources ·{" "}
                  <span aria-hidden="true">⬡</span> Clusters · dotted ring =
                  Rule-based
                </div>
                <div className="nb-actions">
                  <button
                    className="nb-icon-button"
                    aria-label="Pan left"
                    onClick={() => controls.current?.pan(40, 0)}
                  >
                    <ArrowLeft size={14} />
                  </button>
                  <button
                    className="nb-icon-button"
                    aria-label="Pan up"
                    onClick={() => controls.current?.pan(0, 40)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    className="nb-icon-button"
                    aria-label="Pan down"
                    onClick={() => controls.current?.pan(0, -40)}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    className="nb-icon-button"
                    aria-label="Pan right"
                    onClick={() => controls.current?.pan(-40, 0)}
                  >
                    <ArrowRight size={14} />
                  </button>
                  {selected ? (
                    <button
                      className="nb-button"
                      onClick={() => setInspectorOpen(true)}
                    >
                      Inspector
                    </button>
                  ) : null}
                </div>
              </div>
            </section>
            {wide && selected ? (
              <aside
                className="nb-panel nb-graph-inspector"
                data-testid="nb-graph-inspector"
              >
                {inspector}
              </aside>
            ) : null}
          </div>
          <details className="nb-graph-legend" data-testid="nb-graph-legend">
            <summary>Legend and graph boundaries</summary>
            <div className="nb-panel-body">
              <p className="nb-helper">
                {messages.heuristic} Agent suggestions use a dashed ring. No
                imported source is automatically verified.
              </p>
              <div className="nb-actions">
                {clusters.map((name) => (
                  <button
                    key={name}
                    className="nb-button"
                    aria-pressed={cluster === name}
                    onClick={() => setCluster((p) => (p === name ? "" : name))}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <p className="nb-helper">
                Layout: {result.layoutMs.toFixed(1)} ms in a worker ·{" "}
                {scene.n > 400
                  ? "Reduced detail for dense views"
                  : "Full shape detail"}{" "}
                · List and Hierarchy expose node attributes without graphics.
              </p>
            </div>
          </details>
          <Modal
            open={filtersOpen}
            onClose={() => setFiltersOpen(false)}
            title="Graph filters"
          >
            {filters}
          </Modal>
          <Modal
            open={!wide && inspectorOpen && Boolean(selected)}
            onClose={() => setInspectorOpen(false)}
            title="Graph inspector"
          >
            <div data-testid="nb-graph-inspector">{inspector}</div>
          </Modal>
        </>
      )}
    </>
  );
}
function GraphInspector({
  node,
  graph,
  demo,
  onFocus,
  onExpand,
  onHide,
}: {
  node: DisplayNode;
  graph: Projection;
  demo: boolean;
  onFocus: () => void;
  onExpand: () => void;
  onHide: () => void;
}) {
  const b = useBrain(),
    relations = graph.edges.filter(
      (e) => e.source === node.id || e.target === node.id,
    ),
    canOpen = node.kind === "note" || b.items.some((c) => c.id === node.id);
  return (
    <div className="nb-inspector-content">
      <OriginChip origin={node.origin} />
      <h2>{node.label}</h2>
      <StatusBadge
        status={
          node.trust === "proposed" ? "trust.proposed" : "trust.heuristic"
        }
      />
      <p className="nb-helper">
        {node.trust === "proposed"
          ? "Suggested in a synthetic example. Not verified."
          : messages.heuristic}
      </p>
      <dl className="nb-metadata">
        <dt>Kind</dt>
        <dd>{node.kind}</dd>
        <dt>Cluster</dt>
        <dd>{node.clusterId}</dd>
        <dt>Connections</dt>
        <dd>{node.degree} in loaded data</dd>
        <dt>ID</dt>
        <dd>
          <code>{node.id}</code>
        </dd>
      </dl>
      <h3>Why this is here</h3>
      <ul className="nb-relation-list">
        {relations.slice(0, 5).map((e) => (
          <li key={e.id}>
            <span>{e.relation}</span>
            <small>
              {e.evidenceCount
                ? e.evidenceCount + " source reference"
                : "Rule-based / proposed relationship"}
            </small>
          </li>
        ))}
      </ul>
      <h3>Source evidence</h3>
      {node.evidence?.length ? (
        node.evidence.map((e, i) => (
          <div className="nb-evidence" key={i}>
            <strong>
              {e.provider} · {e.title}
            </strong>
            <code>{e.messageId ?? "Conversation title"}</code>
            <p>{e.excerpt}</p>
            <Link
              className="nb-button link"
              href={"/library/local/" + encodeURIComponent(e.conversationId)}
              prefetch={false}
            >
              Open source
              <ArrowUpRight size={13} />
            </Link>
          </div>
        ))
      ) : (
        <p className="nb-helper">
          {demo
            ? "No resolvable evidence is attached to this synthetic node."
            : "Select an evidence-linked concept to inspect its exact source excerpts."}
        </p>
      )}
      <div className="nb-actions">
        <button className="nb-button" onClick={onExpand}>
          Expand
        </button>
        <button className="nb-button" onClick={onFocus}>
          Focus
        </button>
        {canOpen ? (
          <Link
            className="nb-button"
            href={
              node.kind === "note"
                ? "/library/note/" + node.id + "?demo=1"
                : "/library/local/" + encodeURIComponent(node.id)
            }
          >
            Open
          </Link>
        ) : null}
        <button
          className="nb-icon-button"
          aria-label="Copy node ID"
          onClick={() =>
            void navigator.clipboard
              .writeText(node.id)
              .then(() => b.setNotice("Node ID copied."))
              .catch(() => b.report("CLIPBOARD"))
          }
        >
          <Copy size={15} />
        </button>
        <button className="nb-button" onClick={onHide}>
          <EyeOff size={14} />
          Hide from this view
        </button>
      </div>
    </div>
  );
}

export function Graph(props:{demo?:boolean;focus?:string;initialMode?:string}){const p=usePrivateMemory(),params=useSearchParams();return p.configured&&params.get("remote")==="1"?<RemoteGraph focus={props.focus}/>:<LocalGraph {...props}/>;}
