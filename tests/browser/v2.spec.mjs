import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
export const archive = Array.from({ length: 3 }, (_, i) => ({
  id: "synth-gpt-" + i,
  title: "SYNTH PostgreSQL architecture " + i,
  current_node: "m1",
  mapping: {
    m1: {
      parent: null,
      message: {
        id: "m1",
        author: { role: "user" },
        content: {
          parts: ["SYNTH PostgreSQL, React and private vault evidence " + i],
        },
      },
    },
  },
}));
async function importPreview(page, raw = archive) {
  await page.goto("/sources?tab=imports");
  await page.getByTestId("nb-import-file").setInputFiles({
    name: "synthetic-chatgpt.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(raw)),
  });
  await expect(page.getByTestId("nb-consent-local-storage")).toBeVisible();
}
async function storedCount(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("neural-core-local-v1", 1);
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction("conversations", "readonly"),
            req = tx.objectStore("conversations").count();
          req.onsuccess = () => {
            resolve(req.result);
            db.close();
          };
          req.onerror = () => reject(req.error);
        };
        open.onerror = () => reject(open.error);
      }),
  );
}
async function seed(page, count) {
  await page.goto("/library");
  await page.evaluate(
    (count) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("neural-core-local-v1", 1);
        req.onupgradeneeded = () =>
          req.result.createObjectStore("conversations", { keyPath: "id" });
        req.onsuccess = () => {
          const db = req.result,
            tx = db.transaction("conversations", "readwrite"),
            store = tx.objectStore("conversations");
          for (let i = 0; i < count; i++) {
            const provider = ["chatgpt", "claude", "gemini"][i % 3];
            store.put({
              id: provider + ":synth-" + i,
              provider,
              title: "SYNTH archive " + i,
              createdAt: null,
              updatedAt: null,
              tags: [],
              messages: [
                {
                  id: "m-" + i,
                  role: "user",
                  text:
                    "SYNTH PostgreSQL React architecture unique-fixture-" + i,
                  at: null,
                },
              ],
            });
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    count,
  );
  await page.reload();
}
test("J1 F01 F02 F03: preview, consent, persistence, export round trip and exact deletion", async ({
  page,
}) => {
  const external = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:3099") &&
      !r.url().startsWith("data:")
    )
      external.push(r.url());
  });
  await importPreview(page);
  await expect(
    page.getByText("Nothing has been saved yet.", { exact: false }),
  ).toBeVisible();
  expect(await storedCount(page)).toBe(0);
  await page.getByTestId("nb-consent-grant").click();
  await expect(page.getByTestId("nb-state-success")).toContainText(
    "Saved 3 conversations",
  );
  expect(await storedCount(page)).toBe(3);
  await page.reload();
  expect(await storedCount(page)).toBe(3);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("nb-export").click(),
  ]);
  const exported = JSON.parse(readFileSync(await download.path(), "utf8"));
  expect(exported.conversations).toHaveLength(3);
  expect(exported.conversations[0].id).toMatch(/^chatgpt:/);
  await page.getByTestId("nb-import-file").setInputFiles({
    name: "synthetic-roundtrip.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await page.getByTestId("nb-consent-grant").click();
  await expect(page.getByTestId("nb-state-success")).toBeVisible();
  expect(await storedCount(page)).toBe(3);
  await page.getByTestId("nb-delete-open").click();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await page.getByTestId("nb-delete-confirm-text").fill("DELETE");
  await page.getByTestId("nb-delete-confirm").click();
  await expect(page.getByTestId("nb-notice")).toContainText(
    "Deleted 3 conversations",
  );
  expect(await storedCount(page)).toBe(0);
  expect(external).toEqual([]);
});
test("F02: declining storage keeps the archive in this tab only", async ({
  page,
}) => {
  await importPreview(page);
  await page.getByTestId("nb-consent-decline").click();
  expect(await storedCount(page)).toBe(0);
  await page.getByRole("link", { name: "Browse without storing" }).click();
  await expect(page.getByTestId("nb-card-conversation")).toHaveCount(3);
  await page.reload();
  await expect(page.getByText("Your archive is empty")).toBeVisible();
  expect(await storedCount(page)).toBe(0);
});
test("J2 F04 F05 F06 F07: 5000 sources remain bounded and local search sends no requests", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await seed(page, 5000);
  await expect(page.getByTestId("nb-card-conversation")).toHaveCount(50);
  expect(
    await page.getByTestId("nb-conversation-list").locator("li").count(),
  ).toBeLessThanOrEqual(60);
  await page.waitForTimeout(200);
  const requests = [];
  const listener = (r) => requests.push(r.url());
  page.on("request", listener);
  await page.getByTestId("nb-library-search").fill("unique-fixture-4242");
  await expect(page.getByTestId("nb-card-conversation")).toHaveCount(1);
  expect(requests).toEqual([]);
  page.off("request", listener);
  await page.getByTestId("nb-card-conversation").getByRole("link").click();
  await page.getByTestId("nb-copy-context").click();
  await expect(page.getByTestId("nb-notice")).toContainText(
    "untrusted content",
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "[m-4242]",
  );
  await page.goto("/");
  await expect(page.getByTestId("nb-kpi-K1")).toContainText("5,000");
  await expect(page.getByTestId("nb-kpi-K5")).not.toContainText("—");
});
test("F01: Claude and normalized Gemini files use the same explicit consent flow", async ({
  page,
}) => {
  for (const raw of [
    [
      {
        uuid: "synth-claude",
        name: "SYNTH Claude",
        chat_messages: [
          {
            uuid: "m1",
            sender: "human",
            content: [{ text: "Synthetic React evidence" }],
          },
        ],
      },
    ],
    {
      conversations: [
        {
          id: "synth-gemini",
          provider: "gemini",
          title: "SYNTH Gemini",
          messages: [
            { id: "m1", role: "user", text: "Synthetic PostgreSQL evidence" },
          ],
        },
      ],
    },
  ]) {
    await importPreview(page, raw);
    await page.getByTestId("nb-consent-grant").click();
    await expect(page.getByTestId("nb-state-success")).toBeVisible();
  }
  expect(await storedCount(page)).toBe(2);
});
test("J3: synthetic note has explicit provenance and links into the same graph projection", async ({
  page,
}) => {
  const id = "550e8400-e29b-41d4-a716-446655440000";
  await page.goto("/library/note/" + id + "?demo=1&tab=provenance");
  await expect(page.getByTestId("nb-provenance")).toContainText(
    "Source not in this browser",
  );
  await expect(page.getByTestId("nb-status-trust.verified")).toHaveCount(0);
  await page.getByRole("link", { name: "Open in graph" }).click();
  await expect(page.getByTestId("nb-graph-viewport")).toBeVisible();
  await expect(page.getByTestId("nb-demo-banner")).toBeVisible();
  await expect(page.getByTestId("nb-graph-inspector")).toContainText(
    "Suggested in a synthetic example",
  );
});
test("J4: synthetic conflict comparison is inert, accessible and cannot approve real data", async ({
  page,
}) => {
  await page.goto("/agents?tab=conflicts");
  const consolidation = page.getByRole("row").filter({
    has: page.getByRole("rowheader", {
      name: "Consolidate duplicates",
      exact: true,
    }),
  });
  await expect(consolidation).toBeVisible();
  expect(await consolidation.getByRole("cell").allTextContents()).toEqual([
    "No",
    "No",
    "No",
    "Yes",
  ]);
  await page.getByTestId("nb-conflict-demo").click();
  await expect(page.getByTestId("nb-diff")).toContainText("Added:");
  await expect(page.getByTestId("nb-switch-resolve-conflict")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.getByTestId("nb-switch-resolve-conflict").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#nb-live-polite")).toContainText(
    "cannot change a real note",
  );
});
test("J5: edit drafts never claim remote publication without an approved write path", async ({
  page,
  context,
}) => {
  await page.goto(
    "/library/note/550e8400-e29b-41d4-a716-446655440000?demo=1&tab=edit",
  );
  await page.getByTestId("nb-editor-body").fill("# SYNTH unsent draft");
  await context.setOffline(true);
  await expect(page.getByTestId("nb-offline-banner")).toBeVisible();
  await expect(page.getByTestId("nb-shell")).toHaveAttribute(
    "data-conn",
    "sync.local-only",
  );
  await expect(page.getByTestId("nb-switch-propose-edit")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await context.setOffline(false);
  await expect(page.getByTestId("nb-status-pub.committed")).toHaveCount(0);
});
test("J7 F08 F09 F14: graph selection, filtering, hierarchy/list and 3D fallback on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/graph?demo=1");
  const viewport = page.getByTestId("nb-graph-viewport");
  await expect(viewport).toBeVisible();
  await viewport.focus();
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("dialog", { name: "Graph inspector", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByTestId("nb-graph-mode-list").click();
  await expect(page.getByTestId("nb-graph-list")).toBeVisible();
  expect(await page.getByTestId("nb-graph-node").count()).toBeLessThanOrEqual(
    50,
  );
  await page.getByTestId("nb-graph-filters").click();
  await page.getByLabel("Filter node kind").selectOption("note");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByTestId("nb-graph-node")).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});
test("F11 F12 F13: every source-derived legacy view resolves and stays local only", async ({
  page,
}) => {
  for (const [old, path] of Object.entries({
    overview: "/",
    network: "/graph",
    memories: "/library",
    insights: "/",
    sources: "/sources",
    settings: "/settings",
  })) {
    await page.goto("/?view=" + old);
    await expect(page).toHaveURL(
      new RegExp(path.replace("/", "\\/") + "(?:\\?|$)"),
    );
    await expect(page.getByTestId("nb-shell")).toHaveAttribute(
      "data-conn",
      "sync.local-only",
    );
  }
  await page.goto("/?view=missing");
  await expect(
    page.getByText("That view moved.", { exact: false }),
  ).toBeVisible();
});
test("keyboard palette, theme preference, 320px reflow and forced colors", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("nb-shell")).toHaveAttribute(
    "data-interactive",
    "true",
  );
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("nb-palette-input")).toBeFocused();
  await page.getByTestId("nb-palette-input").fill("Settings");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/settings$/);
  await page.goto("/settings?tab=appearance");
  await page.getByTestId("nb-pref-theme").selectOption("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ forcedColors: "active" });
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("source linked graph preserves actual lexical citations across providers", async ({
  page,
}) => {
  await seed(page, 6);
  await page.goto("/graph");
  await page.getByTestId("nb-graph-mode-list").click();
  await page.getByTestId("nb-graph-search").fill("PostgreSQL");
  await expect(page.getByTestId("nb-graph-node")).toHaveCount(1);
  await page.getByTestId("nb-graph-node").click();
  await expect(page.getByTestId("nb-graph-inspector")).toContainText(
    "SYNTH PostgreSQL React architecture",
  );
  await expect(
    page
      .getByTestId("nb-graph-inspector")
      .getByRole("link", { name: "Open source" })
      .first(),
  ).toHaveAttribute("href", /\/library\/local\//);
});

for (const theme of ["dark", "light"])
  for (const width of [390, 820, 1440])
    for (const [name, url] of [
      ["overview", "/"],
      ["graph", "/graph?demo=1"],
      ["library", "/library?collection=vault"],
      ["agents", "/agents"],
      ["sources", "/sources"],
      ["settings", "/settings?tab=sync"],
      ["activity", "/activity"],
    ]) {
      test(`a11y ${name} ${theme} ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        await page.goto(url);
        if (name === "graph")
          await expect(page.getByTestId("nb-graph-viewport")).toBeVisible();
        const result = await new AxeBuilder({ page }).analyze();
        expect(
          result.violations.filter((v) =>
            ["serious", "critical"].includes(v.impact ?? ""),
          ),
        ).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      });
    }
