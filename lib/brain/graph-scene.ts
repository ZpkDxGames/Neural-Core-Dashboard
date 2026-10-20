import { KIND, TRUST, FLAG, EDGE_STYLE, type GraphScene } from "./scene.ts";
import type { Projection, DisplayNode } from "./graph-data";
import type { GraphEdge } from "./types";
export function makeScene(
  projection: Projection,
  positions: Float32Array,
  nodes: DisplayNode[],
  edges: GraphEdge[],
): GraphScene {
  const n = nodes.length,
    m = edges.length,
    indices = new Map(nodes.map((node, i) => [node.id, i])),
    original = new Map(projection.nodes.map((node, i) => [node.id, i]));
  const counts = new Map<string, number>();
  for (const node of projection.nodes)
    counts.set(node.clusterId, (counts.get(node.clusterId) ?? 0) + 1);
  const clusters = new Map(
    [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name], i) => [name, Math.min(6, i)]),
  );
  const scene: GraphScene = {
    n,
    ids: nodes.map((n) => n.id),
    labels: nodes.map((n) => n.label),
    x: new Float32Array(n),
    y: new Float32Array(n),
    r: new Float32Array(n),
    kind: new Uint8Array(n),
    trust: new Uint8Array(n),
    flags: new Uint8Array(n),
    cluster: new Uint8Array(n),
    m,
    src: new Int32Array(m),
    dst: new Int32Array(m),
    edgeStyle: new Uint8Array(m),
    edgeWidth: new Float32Array(m),
  };
  nodes.forEach((node, i) => {
    const index = original.get(node.id)!;
    scene.x[i] = positions[index * 2]!;
    scene.y[i] = positions[index * 2 + 1]!;
    scene.r[i] =
      node.kind === "cluster"
        ? 14 + Math.min(14, 2 * Math.sqrt(node.memberCount ?? 0))
        : 5 + Math.min(11, 2.2 * Math.sqrt(node.degree));
    scene.kind[i] = KIND[node.kind]!;
    scene.trust[i] = TRUST[node.trust]!;
    scene.flags[i] =
      (node.flags.conflict ? FLAG.conflict : 0) |
      (node.flags.stale ? FLAG.stale : 0) |
      (node.origin === "demo" ? FLAG.demo : 0);
    scene.cluster[i] = clusters.get(node.clusterId) ?? 6;
  });
  edges.forEach((edge, i) => {
    scene.src[i] = indices.get(edge.source)!;
    scene.dst[i] = indices.get(edge.target)!;
    scene.edgeStyle[i] =
      edge.relation === "mentions" ||
      ["classified", "contains", "origin", "belongs-to"].includes(edge.relation)
        ? EDGE_STYLE.inferred
        : edge.evidenceCount
          ? EDGE_STYLE.evidence
          : EDGE_STYLE.proposed;
    scene.edgeWidth[i] =
      edge.confidence === undefined
        ? 1.25
        : edge.confidence < 0.34
          ? 1
          : edge.confidence < 0.67
            ? 1.5
            : 2.25;
  });
  return scene;
}
