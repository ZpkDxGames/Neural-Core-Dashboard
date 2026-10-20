// Test-only controlled transports are injected into an isolated browser document.
// No fake adapter, credential, route or acknowledgement is shipped in the app.
import { test, expect } from "@playwright/test";
import ts from "typescript";
import { readFileSync } from "node:fs";
function moduleText(path) {
  return ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}
async function fixture(page) {
  await page.goto("/agents?tab=conflicts");
  await page.setContent(
    '<main><h1>Synthetic protocol fixture</h1><p>Test adapter only. No actual memory or connection.</p><article id="proposal">SYNTH competing revision A<button id="review">Review synthetic decision</button></article><dialog><h2>Confirm synthetic review</h2><button id="cancel">Cancel</button><button id="confirm">Confirm review</button></dialog><output id="state">editing</output><button id="queue">Queue synthetic draft</button></main>',
  );
  await page.evaluate(
    ({ diff, coord }) => {
      const modules = {};
      function evaluate(code) {
        const exports = {};
        new Function("exports", "require", code)(exports, (path) => {
          if (path === "./diff.ts") return modules.diff;
          throw Error("Unknown test import");
        });
        return exports;
      }
      modules.diff = evaluate(diff);
      const { ReviewCoordinator, DraftCoordinator } = evaluate(coord);
      let complete;
      const review = new ReviewCoordinator(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
        true,
      );
      review.items = [{ id: "synth-a" }, { id: "synth-b" }];
      const dialog = document.querySelector("dialog");
      document.querySelector("#review").onclick = () => dialog.showModal();
      document.querySelector("#cancel").onclick = () => dialog.close();
      document.querySelector("#confirm").onclick = async () => {
        dialog.close();
        document.querySelector("#proposal").dataset.pending = "true";
        await review.decide(
          "synth-a",
          "verify",
          2,
          true,
          new AbortController().signal,
        );
        if (!review.items.some((p) => p.id === "synth-a"))
          document.querySelector("#proposal").remove();
      };
      window.ackReview = () =>
        complete({
          origin: "demo",
          state: "ready",
          confirmedAt: "2026-10-20T00:00:00Z",
          data: { id: "synth-a" },
        });
      const draft = new DraftCoordinator();
      const render = () => {
        document.querySelector("#state").textContent = draft.state;
      };
      document.querySelector("#queue").onclick = () => {
        draft.queue();
        draft.sending(navigator.onLine);
        render();
      };
      addEventListener("online", () => {
        draft.sending(true);
        render();
      });
      window.ackDraft = (state) => {
        draft.acknowledge({
          origin: "demo",
          state: "ready",
          confirmedAt: "2026-10-20T00:00:00Z",
          data: { state },
        });
        render();
      };
    },
    {
      diff: moduleText("lib/brain/diff.ts"),
      coord: moduleText("lib/brain/coordination.ts"),
    },
  );
}
test("J4 controlled fake: owner confirmation and matching acknowledgement gate queue removal", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "Review synthetic decision" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("#proposal")).toBeVisible();
  await page.getByRole("button", { name: "Review synthetic decision" }).click();
  await page
    .getByRole("button", { name: "Confirm review", exact: true })
    .click();
  await expect(page.locator("#proposal")).toHaveAttribute(
    "data-pending",
    "true",
  );
  await expect(page.locator("#proposal")).toBeVisible();
  await page.evaluate(() => window.ackReview());
  await expect(page.locator("#proposal")).toHaveCount(0);
});
test("J5 controlled fake: offline queue, reconnect, publishing and committed follow explicit acknowledgements", async ({
  page,
  context,
}) => {
  await fixture(page);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Queue synthetic draft" }).click();
  await expect(page.locator("#state")).toHaveText("queued-local");
  await context.setOffline(false);
  await expect(page.locator("#state")).toHaveText("sending");
  await page.evaluate(() => window.ackDraft("accepted"));
  await expect(page.locator("#state")).toHaveText("accepted");
  await page.evaluate(() => window.ackDraft("publishing"));
  await expect(page.locator("#state")).toHaveText("publishing");
  await page.evaluate(() => window.ackDraft("committed"));
  await expect(page.locator("#state")).toHaveText("committed");
});
