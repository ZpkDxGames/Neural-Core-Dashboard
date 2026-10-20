import { test, expect } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import os from "node:os";
const pct = (v, p) =>
  [...v].sort((a, b) => a - b)[
    Math.min(v.length - 1, Math.ceil(v.length * p) - 1)
  ];
test("measured cold payload, 5000-source search, graph frame samples and repeated route cleanup", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    window.__nbPerf = { tasks: [], errors: [] };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        window.__nbPerf.tasks.push({ at: e.startTime, ms: e.duration });
    }).observe({ type: "longtask", buffered: true });
    addEventListener("error", (e) => window.__nbPerf.errors.push(e.message));
  });
  const requests = [],
    js = new Set();
  page.on("request", (r) => requests.push(r.url()));
  page.on("response", (r) => {
    if (new URL(r.url()).pathname.endsWith(".js"))
      js.add(new URL(r.url()).pathname);
  });
  const start = performance.now();
  await page.goto("/");
  await expect(page.getByTestId("nb-kpi-K1")).toContainText("0");
  const coldReadyMs = performance.now() - start;
  const rootJs = [...js];
  const rootMetrics = await page.evaluate(() => ({
    navigation: performance.getEntriesByType("navigation")[0]?.toJSON(),
    heap: performance.memory?.usedJSHeapSize,
    longTasks: window.__nbPerf.tasks,
  }));
  const assets = await Promise.all(
    rootJs.map(async (path) => {
      const body = await readFile(".next" + path.replace("/_next", ""));
      return { path, bytes: body.length, gzip: gzipSync(body).length };
    }),
  );
  const lazy = JSON.parse(
    await readFile(".next/react-loadable-manifest.json", "utf8"),
  );
  const threeFiles = new Set(
    Object.values(lazy)
      .flatMap((v) => v.files)
      .map((f) => "/_next/" + f),
  );
  expect(rootJs.some((f) => threeFiles.has(f))).toBe(false);
  await page.goto("/library");
  const seedStart = performance.now();
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("neural-core-local-v1", 1);
        req.onsuccess = () => {
          const db = req.result,
            tx = db.transaction("conversations", "readwrite");
          for (let i = 0; i < 5000; i++)
            tx.objectStore("conversations").put({
              id: "chatgpt:synth-" + i,
              provider: "chatgpt",
              title: "SYNTH source " + i,
              createdAt: null,
              updatedAt: null,
              tags: [],
              messages: [
                {
                  id: "synth-m-" + i,
                  role: "user",
                  text: "SYNTH PostgreSQL architecture unique-fixture-" + i,
                  at: null,
                },
              ],
            });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
  const seedTransactionMs = performance.now() - seedStart;
  await page.reload();
  await expect(page.getByTestId("nb-card-conversation")).toHaveCount(50);
  await page.waitForTimeout(200);
  const search = [];
  const beforeRequests = requests.length;
  for (let i = 0; i < 20; i++) {
    const at = performance.now();
    await page
      .getByTestId("nb-library-search")
      .fill("unique-fixture-" + (4200 + i));
    await expect(page.getByTestId("nb-card-conversation")).toHaveCount(1);
    await expect(page.getByTestId("nb-card-conversation")).toContainText(
      "SYNTH source " + (4200 + i),
    );
    search.push(performance.now() - at);
  }
  expect(requests.length).toBe(beforeRequests);
  await page.goto("/graph");
  await expect(page.getByTestId("nb-graph-viewport")).toBeVisible();
  await expect(
    page.getByText("This is a bounded graph window.", { exact: false }),
  ).toBeVisible();
  expect(requests.some((u) => threeFiles.has(new URL(u).pathname))).toBe(false);
  const graphCount = await page.getByTestId("nb-graph-status").innerText();
  await page.getByText("Legend and graph boundaries").click();
  const layoutText = await page.getByTestId("nb-graph-legend").innerText();
  const interactionStart = await page.evaluate(() => performance.now());
  const frames = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const gaps = [];
        let last = performance.now();
        const end = last + 2500;
        function sample(at) {
          gaps.push(at - last);
          last = at;
          if (at < end) requestAnimationFrame(sample);
          else resolve(gaps.slice(1));
        }
        requestAnimationFrame(sample);
      }),
  );
  for (let i = 0; i < 12; i++) {
    await page
      .getByRole("button", {
        name: i % 2 ? "Zoom out" : "Zoom in",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Pan right", exact: true }).click();
  }
  const graphMetrics = await page.evaluate(
    (at) => ({
      heap: performance.memory?.usedJSHeapSize,
      longTasks: window.__nbPerf.tasks.filter((t) => t.at >= at),
      canvases: document.querySelectorAll("canvas").length,
    }),
    interactionStart,
  );
  expect(graphMetrics.canvases).toBe(2);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  const heapBefore = (await cdp.send("Runtime.getHeapUsage")).usedSize;
  for (let i = 0; i < 10; i++) {
    await page
      .getByRole("link", { name: "Knowledge Library", exact: true })
      .click();
    await expect(page.getByTestId("nb-library-search")).toBeVisible();
    expect(await page.locator("canvas").count()).toBe(0);
    await page.getByRole("link", { name: "Neural Graph", exact: true }).click();
    await expect(page.getByTestId("nb-graph-viewport")).toBeVisible();
  }
  await cdp.send("HeapProfiler.collectGarbage");
  const heapAfter = (await cdp.send("Runtime.getHeapUsage")).usedSize;
  const errors = await page.evaluate(() => window.__nbPerf.errors);
  expect(errors).toEqual([]);
  expect(
    requests.filter((u) => !u.startsWith("http://127.0.0.1:3099")),
  ).toEqual([]);
  const report = {
    at: new Date().toISOString(),
    runtime: {
      node: process.version,
      browser: browser.version(),
      cpu: os.cpus()[0]?.model,
      cpus: os.cpus().length,
      memory: os.totalmem(),
      graphics: "headless software SwiftShader",
    },
    fixture: {
      sources: 5000,
      messages: 5000,
      searchSamples: 20,
      graphRouteCycles: 10,
    },
    coldReadyMs,
    rootMetrics,
    assets,
    jsBytes: assets.reduce((n, a) => n + a.bytes, 0),
    jsGzipBytes: assets.reduce((n, a) => n + a.gzip, 0),
    seedTransactionMs,
    search: {
      p50: pct(search, 0.5),
      p95: pct(search, 0.95),
      max: Math.max(...search),
      samples: search,
      noNetwork: true,
    },
    graph: {
      count: graphCount,
      layout: layoutText,
      frameGapMs: {
        p50: pct(frames, 0.5),
        p95: pct(frames, 0.95),
        max: Math.max(...frames),
      },
      idleRafMedianFps: 1000 / pct(frames, 0.5),
      ...graphMetrics,
    },
    cleanup: {
      heapBefore,
      heapAfter,
      delta: heapAfter - heapBefore,
      canvasesRemovedEachCycle: true,
    },
    unmeasured: [
      "field INP/LCP/CLS p75",
      "React render commit count",
      "native hardware GPU memory/draw-call counters",
      "VPS/Minecraft/PlexonPanel impact",
      "iOS/Android performance",
    ],
  };
  await mkdir("docs/ui/evidence", { recursive: true });
  await writeFile(
    "docs/ui/evidence/browser-performance.json",
    JSON.stringify(report, null, 2) + "\n",
  );
});
