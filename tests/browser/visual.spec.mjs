import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
const note = "550e8400-e29b-41d4-a716-446655440000";
const cases = [
  ["overview", "local", "/", true],
  ["graph", "map", "/graph?demo=1"],
  ["graph", "focused", "/graph?demo=1&focus=" + note],
  ["library", "local", "/library/local/chatgpt%3Asynth-0", true],
  ["library", "note", "/library/note/" + note + "?demo=1"],
  ["library", "provenance", "/library/note/" + note + "?demo=1&tab=provenance"],
  ["agents", "unavailable", "/agents"],
  ["agents", "conflict", "/agents?tab=conflicts"],
  ["sources", "consent", "/sources?tab=imports"],
  ["settings", "owner-error", "/settings"],
  ["settings", "sync", "/settings?tab=sync"],
  ["activity", "unavailable", "/activity?tab=queue"],
];
async function seed(page) {
  await page.goto("/library");
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("neural-core-local-v1", 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains("conversations"))
            req.result.createObjectStore("conversations", { keyPath: "id" });
        };
        req.onsuccess = () => {
          const db = req.result,
            tx = db.transaction("conversations", "readwrite");
          for (let i = 0; i < 5; i++)
            tx.objectStore("conversations").put({
              id: "chatgpt:synth-" + i,
              provider: "chatgpt",
              title: [
                "SYNTH — Private memory architecture",
                "SYNTH — React interface decisions",
                "SYNTH — PostgreSQL evidence model",
                "SYNTH — Backup recovery procedure",
                "SYNTH — Knowledge graph exploration",
              ][i],
              createdAt: null,
              updatedAt: null,
              tags: [],
              messages: [
                {
                  id: "synth-m-" + i,
                  role: "user",
                  text: "SYNTHETIC SOURCE — PostgreSQL, React, accessibility and private evidence. This is a synthetic fixture, not a personal conversation.",
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
}
for (const theme of ["dark", "light"])
  for (const width of [1440, 820, 390])
    for (const [route, state, url, local] of cases) {
      test(`visual ${route} ${state} ${theme} ${width}`, async ({
        page,
      }, info) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        await page.route("**/api/auth/owner/**", (r) =>
          r.fulfill({
            status: 503,
            json: { error: "AUTH_UNAVAILABLE", reason: "configuration" },
            headers: {
              "x-ncore-auth-request-id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            },
          }),
        );
        if (local) await seed(page);
        await page.goto(url);
        if (route === "graph") {
          await expect(page.getByTestId("nb-graph-viewport")).toBeVisible();
          if (state === "focused" && width < 1280)
            await page
              .getByRole("button", { name: "Inspector", exact: true })
              .click();
        }
        if (state === "conflict")
          await page.getByTestId("nb-conflict-demo").click();
        if (state === "consent") {
          await page.getByTestId("nb-import-file").setInputFiles({
            name: "SYNTH-example.json",
            mimeType: "application/json",
            buffer: Buffer.from(
              JSON.stringify([
                {
                  id: "synth-preview-1",
                  provider: "generic",
                  title: "SYNTH source preview",
                  messages: [
                    {
                      id: "synth-m1",
                      role: "user",
                      text: "Synthetic private memory planning.",
                    },
                  ],
                },
              ]),
            ),
          });
          await expect(
            page.getByTestId("nb-consent-local-storage"),
          ).toBeVisible();
        }
        if (state === "note")
          await expect(page.getByTestId("nb-markdown")).toHaveAttribute(
            "aria-busy",
            "false",
          );
        if (state === "owner-error")
          await expect(
            page.getByLabel("Google owner authentication"),
          ).toContainText("Preview configuration correction");
        if (state === "local" && route === "library")
          await expect(page.getByTestId("nb-copy-context")).toBeVisible();
        const result = await new AxeBuilder({ page }).analyze();
        const serious = result.violations.filter((v) =>
          ["serious", "critical"].includes(v.impact ?? ""),
        );
        expect(serious).toEqual([]);
        await info.attach("axe", {
          body: JSON.stringify({
            violations: result.violations.map((v) => ({
              id: v.id,
              impact: v.impact,
              count: v.nodes.length,
            })),
          }),
          contentType: "application/json",
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const dir = "docs/ui/evidence/shots/" + route;
        await mkdir(dir, { recursive: true });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: `${dir}/${state}.${theme}.${width}.png`,
          fullPage: (await page.getByRole("dialog").count()) === 0,
        });
      });
    }
test("non-happy states, forced colors, reduced motion and keyboard focus captures", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/sources?tab=imports");
  await page.getByTestId("nb-import-file").setInputFiles({
    name: "SYNTH-invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("{invalid"),
  });
  await expect(page.locator("[data-state=error][role=alert]")).toContainText(
    "Nothing has been saved",
  );
  await mkdir("docs/ui/evidence/shots/states", { recursive: true });
  await page.screenshot({
    path: "docs/ui/evidence/shots/states/invalid.dark.390.png",
    fullPage: true,
  });
  await page.goto("/graph?demo=1&mode=list");
  await expect(page.getByTestId("nb-graph-list")).toBeVisible();
  await page.emulateMedia({ forcedColors: "active" });
  await page.screenshot({
    path: "docs/ui/evidence/shots/states/forced-colors.dark.390.png",
    fullPage: true,
  });
  await page.emulateMedia({ forcedColors: "none" });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/settings?tab=appearance");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/ui/evidence/shots/states/reflow.dark.320.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 640, height: 900 });
  await page.screenshot({
    path: "docs/ui/evidence/shots/states/zoom-equivalent.dark.640.png",
    fullPage: true,
  });
  await expect(page.getByTestId("nb-shell")).toHaveAttribute(
    "data-interactive",
    "true",
  );
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("nb-palette-input")).toBeFocused();
  await page.screenshot({
    path: "docs/ui/evidence/shots/states/keyboard-palette.dark.640.png",
    fullPage: true,
  });
});
