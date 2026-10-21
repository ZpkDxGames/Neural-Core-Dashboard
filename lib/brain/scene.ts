// lib/brain/graph/scene.ts — renderer-agnostic scene + renderer contract.
import type { Lod, View } from "./spatial.ts";
export const KIND = { note: 0, source: 1, concept: 2, cluster: 3 } as const;
export const TRUST = {
  verified: 0,
  proposed: 1,
  heuristic: 2,
  rejected: 3,
} as const;
export const FLAG = { conflict: 1, stale: 2, demo: 4 } as const;
export const EDGE_STYLE = { evidence: 0, proposed: 1, inferred: 2 } as const;

export interface GraphScene {
  labels?: string[];
  n: number;
  ids: string[];
  x: Float32Array;
  y: Float32Array;
  r: Float32Array;
  kind: Uint8Array;
  trust: Uint8Array;
  flags: Uint8Array;
  cluster: Uint8Array;
  m: number;
  src: Int32Array;
  dst: Int32Array;
  edgeStyle: Uint8Array;
  edgeWidth: Float32Array;
}
export interface GraphTheme {
  // resolved once per theme change from CSS variables (or system colours in forced-colors)
  edge: string;
  edgeActive: string;
  text: string;
  accent: string;
  danger: string;
  raised: string;
  canvas: string;
  clusters: string[];
}
export interface Selection {
  selected: number;
  hover: number;
  neighbors: Uint8Array | null;
} // -1 = none
export interface GraphRenderer {
  readonly kind: "canvas2d" | "webgl";
  mount(host: HTMLElement): void;
  setScene(s: GraphScene): void;
  setView(v: View, dpr: number): void;
  setSelection(s: Selection): void;
  setTheme(t: GraphTheme): void;
  setLod(l: Lod): void;
  invalidate(): void;
  hitTest(px: number, py: number, coarse: boolean): number;
  dispose(): void;
}

/** Read colours from tokens; the ONLY place the renderer touches CSS. Forced-colors => system colours. */
export function readGraphTheme(
  el: Element = document.documentElement,
): GraphTheme {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  if (matchMedia("(forced-colors: active)").matches)
    return {
      edge: "GrayText",
      edgeActive: "Highlight",
      text: "CanvasText",
      accent: "Highlight",
      danger: "CanvasText",
      raised: "Canvas",
      canvas: "Canvas",
      clusters: Array(7).fill("CanvasText"),
    };
  return {
    edge: v("--nb-line-strong"),
    edgeActive: v("--nb-accent"),
    text: v("--nb-text"),
    accent: v("--nb-accent"),
    danger: v("--nb-danger"),
    raised: v("--nb-raised"),
    canvas: v("--nb-canvas"),
    clusters: [1, 2, 3, 4, 5, 6]
      .map((i) => v(`--nb-cluster-${i}`))
      .concat(v("--nb-cluster-other")),
  };
}
