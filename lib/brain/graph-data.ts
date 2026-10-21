import { buildGraph, demoGraph } from "../graph.ts";
import { DEMO_NOTES } from "./demo.ts";
import { neutralizeBidi } from "./links.ts";
import type { Conversation, GraphEvidence } from "../types";
import type { GraphNode, GraphEdge } from "./types";
export type DisplayNode = GraphNode & {
  provider?: string;
  evidence?: GraphEvidence[];
};
export type Projection = {
  nodes: DisplayNode[];
  edges: GraphEdge[];
  loadedSources: number;
  totalSources: number;
  partial: boolean;
};
export function projectGraph(
  items: Conversation[],
  demo: boolean,
  total: number,
  focus?: string,
): Projection {
  let selected = items;
  const focused = items.find((c) => c.id === focus);
  if (focused)
    selected = [focused, ...items.filter((c) => c.id !== focus).slice(0, 1000)];
  const graph = demo ? demoGraph() : buildGraph(selected, 1200),
    origin = demo ? "demo" : "local";
  const degrees = new Map<string, number>();
  for (const e of graph.edges) {
    degrees.set(e.source, (degrees.get(e.source) ?? 0) + 1);
    degrees.set(e.target, (degrees.get(e.target) ?? 0) + 1);
  }
  const nodes: DisplayNode[] = graph.nodes.map((n) => ({
    id: n.id,
    label: neutralizeBidi(n.label).slice(0, 80),
    kind:
      n.type === "concept"
        ? "concept"
        : n.type === "conversation"
          ? "source"
          : "cluster",
    trust: "heuristic",
    flags: {},
    degree: degrees.get(n.id) ?? 0,
    clusterId: n.category,
    memberCount:
      n.type === "category"
        ? graph.nodes.filter(
            (x) => x.type === "conversation" && x.category === n.category,
          ).length
        : undefined,
    origin,
    provider: n.provider,
    evidence: n.evidence,
  }));
  const edges: GraphEdge[] = graph.edges.map((e, i) => ({
    id: "edge-" + i,
    source: e.source,
    target: e.target,
    relation: e.type,
    evidenceCount: e.type === "mentions" ? 1 : 0,
    directed: e.type === "mentions",
    origin,
  }));
  if (demo) {
    for (const note of DEMO_NOTES)
      nodes.push({
        id: note.noteId,
        label: note.title,
        kind: "note",
        trust: "proposed",
        flags: {},
        degree: 1,
        clusterId: "Development",
        revision: note.revision,
        origin: "demo",
      });
    edges.push({
      id: "demo-note-relation",
      source: DEMO_NOTES[0]!.noteId,
      target: DEMO_NOTES[1]!.noteId,
      relation: "related",
      evidenceCount: 0,
      directed: false,
      origin: "demo",
    });
  }
  const loadedSources = graph.nodes.filter(
    (n) => n.type === "conversation",
  ).length;
  return {
    nodes,
    edges,
    loadedSources,
    totalSources: demo ? loadedSources : total,
    partial: !demo && loadedSources < total,
  };
}
