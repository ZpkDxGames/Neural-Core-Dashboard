"use client";
import { useEffect, useRef, type MutableRefObject } from "react";
import { Canvas2DRenderer } from "@/lib/brain/canvas2d";
import { readGraphTheme, type GraphScene } from "@/lib/brain/scene";
import { selectLod, type View, type Lod } from "@/lib/brain/spatial";
export type CanvasControls = {
  zoom: (factor: number) => void;
  fit: () => void;
  pan: (dx: number, dy: number) => void;
};
export function GraphCanvas({
  scene,
  selected,
  onSelect,
  onExpand,
  onFocus,
  onList,
  controls,
}: {
  scene: GraphScene;
  selected: string | null;
  onSelect: (id: string) => void;
  onExpand: () => void;
  onFocus: () => void;
  onList: () => void;
  controls: MutableRefObject<CanvasControls | null>;
}) {
  const host = useRef<HTMLDivElement>(null),
    renderer = useRef<Canvas2DRenderer | null>(null),
    view = useRef<View>({ cx: 0, cy: 0, zoom: 1, width: 1, height: 1 }),
    data = useRef(scene),
    selection = useRef(selected),
    handlers = useRef({ onSelect, onExpand, onFocus, onList }),
    lod = useRef<Lod>(3);
  data.current = scene;
  selection.current = selected;
  handlers.current = { onSelect, onExpand, onFocus, onList };
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const render = new Canvas2DRenderer();
    renderer.current = render;
    render.mount(el);
    render.setTheme(readGraphTheme());
    render.setScene(data.current);
    const paint = () => {
      render.setView(view.current, Math.min(devicePixelRatio, 2));
      lod.current = selectLod(data.current.n, lod.current, false);
      render.setLod(lod.current);
    };
    const fit = () => {
      const s = data.current;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (let i = 0; i < s.n; i++) {
        minX = Math.min(minX, s.x[i]!);
        minY = Math.min(minY, s.y[i]!);
        maxX = Math.max(maxX, s.x[i]!);
        maxY = Math.max(maxY, s.y[i]!);
      }
      view.current = {
        ...view.current,
        cx: (minX + maxX) / 2 || 0,
        cy: (minY + maxY) / 2 || 0,
        zoom: Math.max(
          0.15,
          Math.min(
            1.5,
            (view.current.width - 100) / (maxX - minX + 50),
            (view.current.height - 100) / (maxY - minY + 50),
          ),
        ),
      };
      paint();
    };
    const zoom = (factor: number) => {
      view.current = {
        ...view.current,
        zoom: Math.max(0.15, Math.min(6, view.current.zoom * factor)),
      };
      paint();
    };
    const pan = (dx: number, dy: number) => {
      view.current = {
        ...view.current,
        cx: view.current.cx - dx / view.current.zoom,
        cy: view.current.cy - dy / view.current.zoom,
      };
      paint();
    };
    controls.current = { fit, zoom, pan };
    let first = true;
    const resize = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      view.current = {
        ...view.current,
        width: rect.width,
        height: rect.height,
      };
      if (first) {
        first = false;
        fit();
      } else paint();
    });
    resize.observe(el);
    const theme = new MutationObserver(() => {
      render.setTheme(readGraphTheme());
    });
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const dark = matchMedia("(prefers-color-scheme: dark)"),
      forced = matchMedia("(forced-colors: active)"),
      themeChange = () => render.setTheme(readGraphTheme());
    dark.addEventListener("change", themeChange);
    forced.addEventListener("change", themeChange);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    let drag: {
      x: number;
      y: number;
      startX: number;
      startY: number;
      id: number;
    } | null = null;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      drag = {
        x: e.clientX,
        y: e.clientY,
        startX: e.clientX,
        startY: e.clientY,
        id: e.pointerId,
      };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (drag) {
        pan(e.clientX - drag.x, e.clientY - drag.y);
        drag.x = e.clientX;
        drag.y = e.clientY;
      }
    };
    const up = (e: PointerEvent) => {
      if (!drag) return;
      const clicked =
        Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5;
      if (clicked) {
        const rect = el.getBoundingClientRect(),
          i = render.hitTest(
            e.clientX - rect.left,
            e.clientY - rect.top,
            e.pointerType === "touch",
          );
        if (i >= 0) handlers.current.onSelect(data.current.ids[i]!);
      }
      drag = null;
      if (el.hasPointerCapture(e.pointerId))
        el.releasePointerCapture(e.pointerId);
    };
    const cancel = () => {
      drag = null;
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    return () => {
      resize.disconnect();
      theme.disconnect();
      dark.removeEventListener("change", themeChange);
      forced.removeEventListener("change", themeChange);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
      render.dispose();
      renderer.current = null;
      controls.current = null;
    };
  }, [controls]);
  useEffect(() => {
    renderer.current?.setScene(scene);
    lod.current = selectLod(scene.n, lod.current, false);
    renderer.current?.setLod(lod.current);
  }, [scene]);
  useEffect(() => {
    const index = selected ? scene.ids.indexOf(selected) : -1;
    renderer.current?.setSelection({
      selected: index,
      hover: -1,
      neighbors: null,
    });
  }, [scene, selected]);
  return (
    <div
      className="nb-graph-canvas"
      ref={host}
      tabIndex={0}
      role="group"
      aria-roledescription="graph"
      aria-label={`Knowledge graph: ${scene.n} nodes, ${scene.m} links. Press L for list, Home to select, arrows to explore.`}
      data-testid="nb-graph-viewport"
      onKeyDown={(e) => {
        const s = data.current,
          index = selection.current ? s.ids.indexOf(selection.current) : -1,
          key = e.key.toLowerCase();
        if (["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key)) {
          e.preventDefault();
          const dx = key === "arrowleft" ? -1 : key === "arrowright" ? 1 : 0,
            dy = key === "arrowup" ? -1 : key === "arrowdown" ? 1 : 0;
          if (e.shiftKey) {
            controls.current?.pan(-dx * 40, -dy * 40);
            return;
          }
          if (index < 0) {
            if (s.ids[0]) onSelect(s.ids[0]);
            return;
          }
          let best = -1,
            distance = Infinity;
          for (let i = 0; i < s.n; i++) {
            if (i === index) continue;
            const x = s.x[i]! - s.x[index]!,
              y = s.y[i]! - s.y[index]!;
            if ((dx && Math.sign(x) !== dx) || (dy && Math.sign(y) !== dy))
              continue;
            const score = Math.hypot(x, y) + (dx ? Math.abs(y) : Math.abs(x));
            if (score < distance) {
              distance = score;
              best = i;
            }
          }
          if (best >= 0) onSelect(s.ids[best]!);
        } else if (key === "home") {
          e.preventDefault();
          const i = Array.from(s.r).indexOf(Math.max(...s.r));
          if (s.ids[i]) onSelect(s.ids[i]);
        } else if (key === "+" || key === "=") {
          e.preventDefault();
          controls.current?.zoom(1.2);
        } else if (key === "-") {
          e.preventDefault();
          controls.current?.zoom(1 / 1.2);
        } else if (key === "0") {
          e.preventDefault();
          controls.current?.fit();
        } else if (key === "l") {
          e.preventDefault();
          onList();
        } else if (key === "e") {
          e.preventDefault();
          onExpand();
        } else if (key === "f") {
          e.preventDefault();
          onFocus();
        } else if (key === "enter" && index >= 0) {
          e.preventDefault();
          onSelect(s.ids[index]!);
        }
      }}
    />
  );
}
