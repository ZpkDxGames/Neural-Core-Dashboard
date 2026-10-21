import { test, expect } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
test("optional software WebGL draws lazily, survives repeated teardown and loses context into 2D", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.__nbGpu = { created: 0, deleted: 0, draws: 0 };
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, options) {
      return original.call(
        this,
        kind,
        kind === "webgl2"
          ? { ...options, failIfMajorPerformanceCaveat: false }
          : options,
      );
    };
    for (const method of [
      "createBuffer",
      "deleteBuffer",
      "drawArrays",
      "drawElements",
    ]) {
      const original = WebGL2RenderingContext.prototype[method];
      WebGL2RenderingContext.prototype[method] = function (...args) {
        if (method === "createBuffer") window.__nbGpu.created++;
        if (method === "deleteBuffer") window.__nbGpu.deleted++;
        if (method.startsWith("draw")) window.__nbGpu.draws++;
        return original.apply(this, args);
      };
    }
  });
  await page.goto("/graph?demo=1&focus=550e8400-e29b-41d4-a716-446655440000");
  await expect(page.getByTestId("nb-graph-viewport")).toBeVisible();
  expect(await page.evaluate(() => window.__nbGpu.created)).toBe(0);
  for (let i = 0; i < 3; i++) {
    await page.getByTestId("nb-graph-3d").click();
    await expect(
      page.getByTestId("nb-graph-webgl").locator("canvas"),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__nbGpu.draws))
      .toBeGreaterThan(0);
    await page.getByTestId("nb-graph-3d").click();
    await expect(page.getByTestId("nb-graph-viewport")).toBeVisible();
    expect(await page.getByTestId("nb-graph-webgl").count()).toBe(0);
  }
  const afterCycles = await page.evaluate(() => window.__nbGpu);
  expect(afterCycles.deleted).toBe(afterCycles.created);
  await page.getByTestId("nb-graph-3d").click();
  const canvas = page.getByTestId("nb-graph-webgl").locator("canvas");
  await expect(canvas).toBeVisible();
  await canvas.evaluate((canvas) => {
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
  });
  await expect(page.getByTestId("nb-graph-viewport")).toBeVisible();
  await expect(page.getByTestId("nb-graph-inspector")).toContainText(
    "A memory is only as useful",
  );
  await expect(
    page.getByText(
      "Graphics paused. Switched to 2D while preserving selection.",
    ),
  ).toBeVisible();
  await mkdir("docs/ui/evidence", { recursive: true });
  await writeFile(
    "docs/ui/evidence/software-gpu.json",
    JSON.stringify(
      {
        testOnlyProbeOverride: true,
        driver: "Chromium SwiftShader; hardware qualification not performed",
        cycles: 3,
        afterCycles,
        afterContextFallback: await page.evaluate(() => window.__nbGpu),
      },
      null,
      2,
    ),
  );
});
