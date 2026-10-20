// components/brain/useWindowedList.ts — fixed-row-height windowing for lists (DOM rows stay bounded).
import { useEffect, useRef, useState } from "react";
import { computeWindow, type WindowOutput } from "./windowed.ts";

export function useWindowedList(count: number, rowH: number, overscan = 6) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [win, setWin] = useState<WindowOutput>(() =>
    computeWindow({ scrollTop: 0, viewportH: 600, rowH, count, overscan }),
  );
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      setWin(
        computeWindow({
          scrollTop: el.scrollTop,
          viewportH: el.clientHeight,
          rowH,
          count,
          overscan,
        }),
      );
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [count, rowH, overscan]);
  return { ref, ...win };
}
/* Usage (rows are fixed height; each <li> carries aria-posinset / aria-setsize):
   const { ref, start, end, offsetTop, totalH } = useWindowedList(items.length, 72);
   <div ref={ref} style={{ overflow: "auto", height: "100%" }} tabIndex={0} aria-label="Conversations">
     <ul style={{ height: totalH, position: "relative", margin: 0, padding: 0, listStyle: "none" }}>
       {items.slice(start, end).map((it, k) => (
         <li key={it.id} aria-posinset={start + k + 1} aria-setsize={items.length}
             style={{ position: "absolute", top: offsetTop + k * 72, height: 72, left: 0, right: 0 }}>…</li>))}
     </ul></div> */
