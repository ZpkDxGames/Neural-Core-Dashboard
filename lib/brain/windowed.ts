// lib/brain/virtual/windowed.ts — fixed-row-height windowing math (no dependency).
export interface WindowInput {
  scrollTop: number;
  viewportH: number;
  rowH: number;
  count: number;
  overscan: number;
}
export interface WindowOutput {
  start: number;
  end: number;
  offsetTop: number;
  totalH: number;
}
export function computeWindow({
  scrollTop,
  viewportH,
  rowH,
  count,
  overscan,
}: WindowInput): WindowOutput {
  const first = Math.floor(Math.max(0, scrollTop) / rowH);
  const visible = Math.ceil(viewportH / rowH) + 1;
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visible + overscan);
  return { start, end, offsetTop: start * rowH, totalH: count * rowH };
}
