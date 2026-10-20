// lib/brain/graph/spatial.ts — culling, spatial grid, LOD with hysteresis. Pure; no DOM.
export type Lod = 0 | 1 | 2 | 3;
export interface View {
  cx: number;
  cy: number;
  zoom: number;
  width: number;
  height: number;
}

/** world -> screen */
export const toScreenX = (x: number, v: View) =>
  (x - v.cx) * v.zoom + v.width / 2;
export const toScreenY = (y: number, v: View) =>
  (y - v.cy) * v.zoom + v.height / 2;

/** Writes indices of nodes inside viewport +margin into `out`; returns the count. No allocation. */
export function cullViewport(
  x: Float32Array,
  y: Float32Array,
  n: number,
  v: View,
  margin: number,
  out: Int32Array,
): number {
  let k = 0;
  for (let i = 0; i < n; i++) {
    const sx = toScreenX(x[i]!, v),
      sy = toScreenY(y[i]!, v);
    if (
      sx >= -margin &&
      sx <= v.width + margin &&
      sy >= -margin &&
      sy <= v.height + margin
    )
      out[k++] = i;
  }
  return k;
}

/** Liang–Barsky: does segment (x0,y0)-(x1,y1) intersect rect [0,w]x[0,h] (screen space, with margin)? */
export function segmentIntersectsRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w: number,
  h: number,
  m: number,
): boolean {
  let t0 = 0,
    t1 = 1;
  const dx = x1 - x0,
    dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 + m, w + m - x0, y0 + m, h + m - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i]! < 0) return false;
    } else {
      const t = q[i]! / p[i]!;
      if (p[i]! < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}

/** Uniform grid in screen space. Built once per data/view change (O(n)); queries are O(1) average. */
export class SpatialGrid {
  scans = 0; // test hook: number of candidate points examined
  private cols = 0;
  private rows = 0;
  private cell: number;
  private start = new Int32Array(0);
  private items = new Int32Array(0);
  constructor(cell = 32) {
    this.cell = cell;
  }

  build(
    sx: Float32Array,
    sy: Float32Array,
    idx: Int32Array,
    count: number,
    width: number,
    height: number,
  ): void {
    this.cols = Math.max(1, Math.ceil(width / this.cell));
    this.rows = Math.max(1, Math.ceil(height / this.cell));
    const cells = this.cols * this.rows;
    if (this.start.length !== cells + 1) this.start = new Int32Array(cells + 1);
    else this.start.fill(0);
    if (this.items.length < count) this.items = new Int32Array(count);
    const cellOf = (i: number) => {
      const c = Math.min(
        this.cols - 1,
        Math.max(0, Math.floor(sx[i]! / this.cell)),
      );
      const r = Math.min(
        this.rows - 1,
        Math.max(0, Math.floor(sy[i]! / this.cell)),
      );
      return r * this.cols + c;
    };
    for (let k = 0; k < count; k++) this.start[cellOf(idx[k]!) + 1]!++;
    for (let c = 0; c < cells; c++) this.start[c + 1]! += this.start[c]!;
    const fill = this.start.slice(0, cells);
    for (let k = 0; k < count; k++) {
      const c = cellOf(idx[k]!);
      this.items[fill[c]!++] = idx[k]!;
    }
  }

  /** Nearest node whose centre is within max(radius[i], minHit) of (px,py); -1 if none. */
  nearest(
    px: number,
    py: number,
    sx: Float32Array,
    sy: Float32Array,
    radius: Float32Array,
    minHit: number,
  ): number {
    const reach = Math.ceil((16 + minHit) / this.cell); // 16 = max node radius
    const c0 = Math.floor(px / this.cell),
      r0 = Math.floor(py / this.cell);
    let best = -1,
      bestD = Infinity;
    for (
      let r = Math.max(0, r0 - reach);
      r <= Math.min(this.rows - 1, r0 + reach);
      r++
    ) {
      for (
        let c = Math.max(0, c0 - reach);
        c <= Math.min(this.cols - 1, c0 + reach);
        c++
      ) {
        const cellIdx = r * this.cols + c;
        for (let k = this.start[cellIdx]!; k < this.start[cellIdx + 1]!; k++) {
          const i = this.items[k]!;
          this.scans++;
          const d = Math.hypot(sx[i]! - px, sy[i]! - py);
          if (d <= Math.max(radius[i]!, minHit) && d < bestD) {
            best = i;
            bestD = d;
          }
        }
      }
    }
    return best;
  }
}

/** Max visible-node count per LOD (P: provisional until measured). LOD0 is unbounded. */
export const LOD_MAX: Record<Lod, number> = {
  3: 100,
  2: 400,
  1: 1500,
  0: Infinity,
};

/** One level at a time, ±10% hysteresis so boundaries do not flicker. */
export function selectLod(
  visible: number,
  prev: Lod,
  hasClusters: boolean,
): Lod {
  const floor: Lod = hasClusters ? 0 : 1;
  let l: Lod = prev < floor ? floor : prev;
  for (let guard = 0; guard < 4; guard++) {
    if (l > 0 && l >= floor + 1 && visible > LOD_MAX[l] * 1.1) {
      l = (l - 1) as Lod;
      continue;
    }
    if (l < 3 && visible < LOD_MAX[(l + 1) as Lod] * 0.9) {
      l = (l + 1) as Lod;
      continue;
    }
    break;
  }
  return l;
}
