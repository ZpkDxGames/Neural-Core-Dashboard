// lib/brain/graph/gpu.ts — resource ownership + context-loss handling for the WebGL renderer (library-agnostic).
export interface Disposable {
  dispose(): void;
}

/** Everything created for the GPU is tracked here and released exactly once. */
export class GpuScope {
  private items = new Set<Disposable>();
  private closed = false;
  track<T extends Disposable>(x: T): T {
    if (this.closed) {
      x.dispose();
      throw new Error("GpuScope closed");
    }
    this.items.add(x);
    return x;
  }
  get size(): number {
    return this.items.size;
  }
  disposeAll(): void {
    if (this.closed) return;
    this.closed = true;
    for (const x of this.items) x.dispose();
    this.items.clear();
  }
}

export interface GlRendererLike {
  dispose(): void;
  forceContextLoss(): void;
  domElement: HTMLCanvasElement;
}
export function teardownRenderer(r: GlRendererLike, scope: GpuScope): void {
  scope.disposeAll();
  r.dispose();
  r.forceContextLoss();
  r.domElement.remove();
}

/** Returns a cleanup fn. Second loss within 60s (or no restore in 3s) => onFallback('canvas2d'). */
export function watchContextLoss(
  canvas: HTMLCanvasElement,
  h: { onLost(): void; onRestored(): void; onFallback(): void },
  now = () => performance.now(),
): () => void {
  let lastLoss = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const lost = (e: Event) => {
    e.preventDefault();
    const t = now();
    h.onLost();
    if (t - lastLoss < 60_000) {
      h.onFallback();
      return;
    }
    lastLoss = t;
    timer = setTimeout(() => h.onFallback(), 3000);
  };
  const restored = () => {
    if (timer) clearTimeout(timer);
    h.onRestored();
  };
  canvas.addEventListener("webglcontextlost", lost);
  canvas.addEventListener("webglcontextrestored", restored);
  return () => {
    if (timer) clearTimeout(timer);
    canvas.removeEventListener("webglcontextlost", lost);
    canvas.removeEventListener("webglcontextrestored", restored);
  };
}
