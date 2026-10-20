import type { Projection } from "./graph-data";
type Quad = {
  x: number;
  y: number;
  size: number;
  mass: number;
  cx: number;
  cy: number;
  point: number;
  children: Quad[] | null;
};
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
/** Deterministic Barnes-Hut layout, computed only in a dedicated worker. */
export function layoutGraph(graph: Projection, maxMs = 800): Float32Array {
  const n = graph.nodes.length,
    positions = new Float32Array(n * 2),
    vx = new Float32Array(n),
    vy = new Float32Array(n);
  const clusters = [
      ...new Set(graph.nodes.map((node) => node.clusterId)),
    ].sort(),
    anchors = new Map(
      clusters.map((c, i) => [
        c,
        [
          Math.cos((i / clusters.length) * Math.PI * 2) * 280,
          Math.sin((i / clusters.length) * Math.PI * 2) * 230,
        ],
      ]),
    );
  const indices = new Map(graph.nodes.map((node, i) => [node.id, i]));
  for (let i = 0; i < n; i++) {
    const node = graph.nodes[i]!,
      seed = hash(node.id),
      angle = ((seed % 10000) / 10000) * Math.PI * 2,
      r =
        node.kind === "cluster"
          ? 0
          : 25 + (Math.sqrt((seed >>> 8) % 10000) / 100) * 125,
      anchor = anchors.get(node.clusterId)!;
    positions[i * 2] = anchor[0]! + Math.cos(angle) * r;
    positions[i * 2 + 1] = anchor[1]! + Math.sin(angle) * r;
  }
  function insert(cell: Quad, index: number, depth = 0): void {
    const x = positions[index * 2]!,
      y = positions[index * 2 + 1]!;
    cell.cx = (cell.cx * cell.mass + x) / (cell.mass + 1);
    cell.cy = (cell.cy * cell.mass + y) / (cell.mass + 1);
    cell.mass++;
    if (cell.point === -1 && !cell.children) {
      cell.point = index;
      return;
    }
    if (depth > 20) return;
    if (!cell.children) {
      const half = cell.size / 2;
      cell.children = [0, 1, 2, 3].map((q) => ({
        x: cell.x + (q % 2) * half,
        y: cell.y + Math.floor(q / 2) * half,
        size: half,
        mass: 0,
        cx: 0,
        cy: 0,
        point: -1,
        children: null,
      }));
      const old = cell.point;
      cell.point = -1;
      const ox = positions[old * 2]!,
        oy = positions[old * 2 + 1]!;
      insert(
        cell.children[
          (ox >= cell.x + half ? 1 : 0) + (oy >= cell.y + half ? 2 : 0)
        ]!,
        old,
        depth + 1,
      );
    }
    const half = cell.size / 2;
    insert(
      cell.children![
        (x >= cell.x + half ? 1 : 0) + (y >= cell.y + half ? 2 : 0)
      ]!,
      index,
      depth + 1,
    );
  }
  const start = performance.now();
  for (let iteration = 0; iteration < 100; iteration++) {
    if (performance.now() - start > maxMs) break;
    const tree: Quad = {
      x: -4096,
      y: -4096,
      size: 8192,
      mass: 0,
      cx: 0,
      cy: 0,
      point: -1,
      children: null,
    };
    for (let i = 0; i < n; i++) insert(tree, i);
    for (let i = 0; i < n; i++) {
      if (graph.nodes[i]!.kind === "cluster") continue;
      const x = positions[i * 2]!,
        y = positions[i * 2 + 1]!;
      let fx = 0,
        fy = 0;
      const visit = (cell: Quad): void => {
        if (!cell.mass || (cell.point === i && !cell.children)) return;
        const dx = x - cell.cx,
          dy = y - cell.cy,
          d2 = dx * dx + dy * dy + 16;
        if (!cell.children || (cell.size * cell.size) / d2 < 0.81) {
          const force = Math.min(5, (80 * cell.mass) / d2);
          fx += dx * force;
          fy += dy * force;
        } else for (const child of cell.children) visit(child);
      };
      visit(tree);
      const anchor = anchors.get(graph.nodes[i]!.clusterId)!;
      fx += (anchor[0]! - x) * 0.025;
      fy += (anchor[1]! - y) * 0.025;
      vx[i] = (vx[i]! + fx * 0.025) * 0.6;
      vy[i] = (vy[i]! + fy * 0.025) * 0.6;
    }
    for (const edge of graph.edges) {
      const a = indices.get(edge.source),
        b = indices.get(edge.target);
      if (a === undefined || b === undefined) continue;
      const dx = positions[b * 2]! - positions[a * 2]!,
        dy = positions[b * 2 + 1]! - positions[a * 2 + 1]!,
        d = Math.max(1, Math.hypot(dx, dy)),
        f = (d - 70) * 0.0007;
      vx[a] = vx[a]! + (dx / d) * f;
      vy[a] = vy[a]! + (dy / d) * f;
      vx[b] = vx[b]! - (dx / d) * f;
      vy[b] = vy[b]! - (dy / d) * f;
    }
    let max = 0;
    for (let i = 0; i < n; i++) {
      if (graph.nodes[i]!.kind === "cluster") continue;
      positions[i * 2] = positions[i * 2]! + vx[i]!;
      positions[i * 2 + 1] = positions[i * 2 + 1]! + vy[i]!;
      max = Math.max(max, Math.abs(vx[i]!), Math.abs(vy[i]!));
    }
    if (iteration > 10 && max < 0.02) break;
  }
  return positions;
}
