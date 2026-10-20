"use client";
import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CanvasControls } from "../GraphCanvas";
import type { GraphScene } from "@/lib/brain/scene";
import { readGraphTheme } from "@/lib/brain/scene";
import { watchContextLoss, GpuScope, teardownRenderer } from "@/lib/brain/gpu";
export default function ThreeGraph({
  scene,
  selected,
  controls,
  playing,
  onSelect,
  onFallback,
}: {
  scene: GraphScene;
  selected: string | null;
  controls: MutableRefObject<CanvasControls | null>;
  playing: boolean;
  onSelect: (id: string) => void;
  onFallback: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    running = useRef(playing),
    selection = useRef(selected),
    select = useRef(onSelect),
    fallback = useRef(onFallback);
  running.current = playing;
  selection.current = selected;
  select.current = onSelect;
  fallback.current = onFallback;
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const scope = new GpuScope(),
      theme = readGraphTheme();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "low-power",
      });
    } catch {
      fallback.current();
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    element.appendChild(renderer.domElement);
    const world = new THREE.Scene();
    world.background = new THREE.Color(theme.canvas);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
    camera.position.set(0, 1, 12);
    const group = new THREE.Group();
    world.add(group);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = false;
    orbit.minDistance = 5;
    orbit.maxDistance = 22;
    const positions = new Float32Array(scene.n * 3),
      colors = new Float32Array(scene.n * 3),
      ids = new Map(scene.ids.map((id, i) => [id, i]));
    for (let i = 0; i < scene.n; i++) {
      const y = 1 - (2 * (i + 0.5)) / Math.max(1, scene.n),
        r = Math.sqrt(1 - y * y),
        angle = i * Math.PI * (3 - Math.sqrt(5));
      positions.set(
        [Math.cos(angle) * r * 4, y * 4, Math.sin(angle) * r * 4],
        i * 3,
      );
      const color = new THREE.Color(
        theme.clusters[scene.cluster[i]!]! ?? theme.text,
      );
      colors.set([color.r, color.g, color.b], i * 3);
    }
    const geometry = scope.track(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = scope.track(
        new THREE.PointsMaterial({
          size: 0.075,
          vertexColors: true,
          sizeAttenuation: true,
        }),
      ),
      points = new THREE.Points(geometry, material);
    group.add(points);
    const lines = new Float32Array(scene.m * 6);
    for (let i = 0; i < scene.m; i++) {
      const a = scene.src[i]!,
        b = scene.dst[i]!;
      lines.set(positions.subarray(a * 3, a * 3 + 3), i * 6);
      lines.set(positions.subarray(b * 3, b * 3 + 3), i * 6 + 3);
    }
    const lineGeometry = scope.track(new THREE.BufferGeometry());
    lineGeometry.setAttribute("position", new THREE.BufferAttribute(lines, 3));
    const lineMaterial = scope.track(
      new THREE.LineBasicMaterial({
        color: theme.edge,
        transparent: true,
        opacity: 0.25,
      }),
    );
    group.add(new THREE.LineSegments(lineGeometry, lineMaterial));
    const highlightGeometry = scope.track(new THREE.BufferGeometry());
    highlightGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(3), 3),
    );
    const highlightMaterial = scope.track(
      new THREE.PointsMaterial({ size: 0.16, color: theme.accent }),
    );
    const highlight = new THREE.Points(highlightGeometry, highlightMaterial);
    group.add(highlight);
    let frame = 0,
      visible = true,
      disposed = false,
      lastFrame = 0;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const reduced = () =>
      document.documentElement.dataset.motion === "reduce" ||
      (document.documentElement.dataset.motion !== "full" && reduce.matches);
    const paint = (at: number) => {
      frame = 0;
      if (disposed) return;
      const animated =
        running.current && !reduced() && !document.hidden && visible;
      if (animated && at - lastFrame < 33) {
        frame = requestAnimationFrame(paint);
        return;
      }
      lastFrame = at;
      if (animated) group.rotation.y += 0.002;
      const selectedIndex = selection.current
        ? ids.get(selection.current)
        : undefined;
      highlight.visible = selectedIndex !== undefined;
      if (selectedIndex !== undefined) {
        (highlightGeometry.getAttribute("position").array as Float32Array).set(
          positions.subarray(selectedIndex * 3, selectedIndex * 3 + 3),
        );
        highlightGeometry.getAttribute("position").needsUpdate = true;
      }
      renderer.render(world, camera);
      if (animated) frame = requestAnimationFrame(paint);
    };
    const invalidate = () => {
      if (!frame && !disposed) frame = requestAnimationFrame(paint);
    };
    orbit.addEventListener("change", invalidate);
    element.addEventListener("nb-resume", invalidate);
    controls.current = {
      zoom: (factor) => {
        camera.position
          .sub(orbit.target)
          .multiplyScalar(1 / factor)
          .add(orbit.target);
        orbit.update();
        invalidate();
      },
      fit: () => {
        orbit.target.set(0, 0, 0);
        camera.position.set(0, 1, 12);
        orbit.update();
        invalidate();
      },
      pan: (dx, dy) => {
        const offset = new THREE.Vector3(-dx / 120, dy / 120, 0);
        camera.position.add(offset);
        orbit.target.add(offset);
        orbit.update();
        invalidate();
      },
    };
    const size = new ResizeObserver(() => {
      camera.aspect = element.clientWidth / Math.max(1, element.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(element.clientWidth, element.clientHeight);
      invalidate();
    });
    size.observe(element);
    const intersection = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? false;
      invalidate();
    });
    intersection.observe(element);
    const loss = watchContextLoss(renderer.domElement, {
      onLost: () => {
        cancelAnimationFrame(frame);
        frame = 0;
      },
      onRestored: invalidate,
      onFallback: () => fallback.current(),
    });
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.13 };
    let downX = 0,
      downY = 0;
    const down = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const click = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
      const rect = element.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = raycaster.intersectObject(points)[0]!;
      if (hit && hit.index !== undefined) select.current(scene.ids[hit.index]!);
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointerup", click);
    document.addEventListener("visibilitychange", invalidate);
    reduce.addEventListener("change", invalidate);
    invalidate();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      loss();
      intersection.disconnect();
      size.disconnect();
      element.removeEventListener("nb-resume", invalidate);
      orbit.removeEventListener("change", invalidate);
      orbit.dispose();
      document.removeEventListener("visibilitychange", invalidate);
      reduce.removeEventListener("change", invalidate);
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointerup", click);
      teardownRenderer(renderer, scope);
      controls.current = null;
      world.clear();
      ids.clear();
    };
  }, [scene, controls]);
  useEffect(() => {
    host.current?.dispatchEvent(new Event("nb-resume"));
  }, [playing, selected]);
  return (
    <div
      ref={host}
      className="nb-graph-canvas"
      role="img"
      aria-label="3D sphere view. Use the graph list for keyboard selection."
      data-testid="nb-graph-webgl"
    />
  );
}
