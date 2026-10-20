// lib/brain/graph/canvas2d.ts — default renderer. Two canvases (static + overlay), draw-on-demand, Path2D batching.
import {
  cullViewport,
  segmentIntersectsRect,
  SpatialGrid,
  toScreenX,
  toScreenY,
  type Lod,
  type View,
} from "./spatial.ts";
import {
  EDGE_STYLE,
  FLAG,
  KIND,
  TRUST,
  type GraphRenderer,
  type GraphScene,
  type GraphTheme,
  type Selection,
} from "./scene.ts";

const DASH: Record<number, number[]> = {
  [TRUST.verified]: [],
  [TRUST.proposed]: [3, 2],
  [TRUST.heuristic]: [1, 2],
  [TRUST.rejected]: [2, 2],
};
const EDGE_DASH: Record<number, number[]> = {
  [EDGE_STYLE.evidence]: [],
  [EDGE_STYLE.proposed]: [6, 4],
  [EDGE_STYLE.inferred]: [1.5, 3],
};

export class Canvas2DRenderer implements GraphRenderer {
  readonly kind = "canvas2d" as const;
  private host!: HTMLElement;
  private base!: HTMLCanvasElement;
  private top!: HTMLCanvasElement;
  private bctx!: CanvasRenderingContext2D;
  private tctx!: CanvasRenderingContext2D;
  private scene: GraphScene | null = null;
  private view: View = { cx: 0, cy: 0, zoom: 1, width: 1, height: 1 };
  private dpr = 1;
  private lod: Lod = 3;
  private theme!: GraphTheme;
  private sel: Selection = { selected: -1, hover: -1, neighbors: null };
  private sx = new Float32Array(0);
  private sy = new Float32Array(0);
  private vis = new Int32Array(0);
  private visCount = 0;
  private grid = new SpatialGrid(32);
  private raf = 0;
  private dirtyBase = false;
  private dirtyTop = false;
  private ro?: ResizeObserver;
  private disposed = false;

  mount(host: HTMLElement): void {
    this.host = host;
    const mk = () => {
      const c = document.createElement("canvas");
      c.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
      c.setAttribute("aria-hidden", "true");
      host.appendChild(c);
      return c;
    };
    this.base = mk();
    this.top = mk();
    this.bctx = this.base.getContext("2d", { alpha: false })!;
    this.tctx = this.top.getContext("2d")!;
    this.ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      this.view = { ...this.view, width: r.width, height: r.height };
      this.resize();
      this.invalidate(true);
    });
    this.ro.observe(host);
  }
  private resize(): void {
    for (const c of [this.base, this.top]) {
      c.width = Math.round(this.view.width * this.dpr);
      c.height = Math.round(this.view.height * this.dpr);
    }
    this.bctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.tctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
  setScene(s: GraphScene): void {
    this.scene = s;
    if (this.sx.length < s.n) {
      this.sx = new Float32Array(s.n);
      this.sy = new Float32Array(s.n);
      this.vis = new Int32Array(s.n);
    }
    this.invalidate(true);
  }
  setView(v: View, dpr: number): void {
    const d = Math.min(dpr, 2);
    const resized =
      d !== this.dpr ||
      v.width !== this.view.width ||
      v.height !== this.view.height;
    this.view = v;
    this.dpr = d;
    if (resized) this.resize();
    this.invalidate(true);
  }
  setSelection(s: Selection): void {
    this.sel = s;
    this.invalidate(this.lod < 2);
  }
  setTheme(t: GraphTheme): void {
    this.theme = t;
    this.invalidate(true);
  }
  setLod(l: Lod): void {
    if (l !== this.lod) {
      this.lod = l;
      this.invalidate(true);
    }
  }
  invalidate(base = true): void {
    if (this.disposed) return;
    this.dirtyBase ||= base;
    this.dirtyTop = true;
    if (!this.raf)
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.frame();
      }); // coalesced; no idle loop
  }
  private project(): void {
    const s = this.scene!;
    const v = this.view;
    this.visCount = cullViewport(s.x, s.y, s.n, v, 64, this.vis);
    for (let k = 0; k < this.visCount; k++) {
      const i = this.vis[k]!;
      this.sx[i] = toScreenX(s.x[i]!, v);
      this.sy[i] = toScreenY(s.y[i]!, v);
    }
    this.grid.build(
      this.sx,
      this.sy,
      this.vis,
      this.visCount,
      v.width,
      v.height,
    );
  }
  get visibleCount(): number {
    return this.visCount;
  }
  private frame(): void {
    if (!this.scene || !this.theme) return;
    if (this.dirtyBase) {
      this.project();
      this.drawBase();
      this.dirtyBase = false;
    }
    if (this.dirtyTop) {
      this.drawOverlay();
      this.dirtyTop = false;
    }
  }
  private drawBase(): void {
    const c = this.bctx,
      s = this.scene!,
      t = this.theme,
      v = this.view;
    c.fillStyle = t.canvas;
    c.fillRect(0, 0, v.width, v.height);
    // Edges: batch by style into one Path2D each => <= 3 strokes. LOD1: only edges touching the selection.
    if (this.lod >= 2 || this.sel.selected >= 0) {
      const paths = [new Path2D(), new Path2D(), new Path2D()];
      for (let e = 0; e < s.m; e++) {
        const a = s.src[e]!,
          b = s.dst[e]!;
        if (this.lod < 2 && a !== this.sel.selected && b !== this.sel.selected)
          continue;
        const ax = toScreenX(s.x[a]!, v),
          ay = toScreenY(s.y[a]!, v),
          bx = toScreenX(s.x[b]!, v),
          by = toScreenY(s.y[b]!, v);
        if (!segmentIntersectsRect(ax, ay, bx, by, v.width, v.height, 64))
          continue;
        const p = paths[s.edgeStyle[e]!]!;
        p.moveTo(ax, ay);
        p.lineTo(bx, by);
      }
      c.strokeStyle = t.edge;
      c.globalAlpha =
        this.sel.selected >= 0 ? 0.18 : this.lod === 2 ? 0.4 : 0.8;
      c.lineWidth = 1.25;
      for (let k = 0; k < 3; k++) {
        c.setLineDash(EDGE_DASH[k]!);
        c.stroke(paths[k]!);
      }
      c.globalAlpha = 1;
      c.setLineDash([]);
    }
    for (let k = 0; k < this.visCount; k++)
      this.drawNode(c, this.vis[k]!, false);
    if (this.lod >= 2 && s.labels) {
      c.font = "12px system-ui";
      c.fillStyle = t.text;
      const cells = new Set<string>();
      let count = 0;
      const ordered = [...this.vis.slice(0, this.visCount)].sort(
        (a, b) =>
          (a === this.sel.selected ? -1 : b === this.sel.selected ? 1 : 0) ||
          s.kind[b]! - s.kind[a]!,
      );
      for (const i of ordered) {
        if (count >= (this.lod === 2 ? 24 : 80)) break;
        const x = this.sx[i]!,
          y = this.sy[i]! + s.r[i]! + 16,
          key = Math.floor(x / 100) + ":" + Math.floor(y / 20);
        if (cells.has(key) && i !== this.sel.selected) continue;
        cells.add(key);
        c.fillText(s.labels[i]!.slice(0, 28), x + 5, y);
        count++;
      }
    }
  }
  private drawNode(c: CanvasRenderingContext2D, i: number, dim: boolean): void {
    const s = this.scene!,
      t = this.theme;
    const x = this.sx[i]!,
      y = this.sy[i]!;
    const r =
      this.lod === 1 ? Math.max(3, Math.min(6, s.r[i]! * 0.5)) : s.r[i]!;
    const trust = s.trust[i]!;
    const hue = t.clusters[Math.min(s.cluster[i]!, 6)]!;
    c.globalAlpha = dim ? 0.25 : 1;
    c.beginPath();
    const kind = this.lod === 1 ? KIND.note : s.kind[i]!; // LOD1 = dots only
    if (kind === KIND.note) c.arc(x, y, r, 0, Math.PI * 2);
    else if (kind === KIND.source)
      c.roundRect(x - r, y - r, 2 * r, 2 * r, r * 0.25);
    else if (kind === KIND.concept) {
      c.moveTo(x, y - r);
      c.lineTo(x + r, y);
      c.lineTo(x, y + r);
      c.lineTo(x - r, y);
      c.closePath();
    } else
      for (let a = 0; a < 6; a++) {
        const ang = (Math.PI / 3) * a - Math.PI / 6;
        const px = x + r * Math.cos(ang),
          py = y + r * Math.sin(ang);
        a ? c.lineTo(px, py) : c.moveTo(px, py);
      }
    c.fillStyle =
      this.lod === 1
        ? hue
        : trust === TRUST.verified
          ? hue
          : trust === TRUST.heuristic
            ? t.raised
            : hue;
    if (trust === TRUST.proposed) c.globalAlpha *= 0.16 / 1; // hollow-ish fill; ring carries meaning
    c.fill();
    c.globalAlpha = dim ? 0.25 : 1;
    if (this.lod !== 1 || r >= 4) {
      c.setLineDash(DASH[trust]!);
      c.lineWidth = trust === TRUST.heuristic ? 1.5 : 2;
      c.strokeStyle = hue;
      c.stroke();
      c.setLineDash([]);
    }
    if (this.lod >= 3 && s.flags[i]! & FLAG.conflict) {
      c.beginPath();
      c.arc(x, y, r + 4, 0, Math.PI * 2);
      c.strokeStyle = t.danger;
      c.lineWidth = 2;
      c.stroke();
    }
    c.globalAlpha = 1;
  }
  private drawOverlay(): void {
    const c = this.tctx,
      v = this.view;
    c.clearRect(0, 0, v.width, v.height);
    const { selected, hover } = this.sel;
    if (!this.scene) return;
    for (const [i, w, col] of [
      [hover, 1, this.theme.text],
      [selected, 3, this.theme.accent],
    ] as const) {
      if (i < 0) continue;
      c.beginPath();
      c.arc(this.sx[i]!, this.sy[i]!, this.scene.r[i]! + 4, 0, Math.PI * 2);
      c.lineWidth = w;
      c.strokeStyle = col;
      c.stroke();
    }
  }
  hitTest(px: number, py: number, coarse: boolean): number {
    if (!this.scene) return -1;
    return this.grid.nearest(
      px,
      py,
      this.sx,
      this.sy,
      this.scene.r,
      coarse ? 22 : 12,
    );
  }
  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.base?.remove();
    this.top?.remove();
    this.scene = null;
  }
}
