import { test, expect } from "@playwright/test";
const corpus = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "<svg onload=alert(1)>",
  "<iframe src='javascript:alert(1)'></iframe>",
  "[x](javascript:alert(1))",
  "[x](JaVaScRiPt:alert(1))",
  "[x](java\nscript:alert(1))",
  "[x](data:text/html;base64,PHNjcmlwdD4=)",
  "![x](https://tracker.invalid/p.gif)",
  "![x](javascript:alert(1))",
  "<a href='javascript:alert(1)'>x</a>",
  "<details open ontoggle=alert(1)>",
  "[x](//evil.invalid)",
  "[x](https://user:pass@evil.invalid)",
  "[[Title|<script>alert(1)</script>]]",
  "![[transclusion-loop]]",
  '---\nstate: "verified"\nnote_id: "x"\n---\n# Self-reported metadata',
  "\u202Eevil\u202C text",
  "`<script>alert(1)</script>`",
  "<style>@import 'https://evil.invalid/x.css'</style>",
  "<form action='https://evil.invalid'><input name=p></form>",
  "<meta http-equiv=refresh content='0;url=https://evil.invalid'>",
  "[x]: javascript:alert(1)\n\n[x]",
  "<math><mtext><table><mglyph><style><img src onerror=alert(1)>",
];
test("Markdown XSS corpus renders inertly with zero image or external requests", async ({
  page,
}) => {
  test.setTimeout(60000);
  const external = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:3099")) external.push(r.url());
  });
  await page.goto(
    "/library/note/550e8400-e29b-41d4-a716-446655440000?demo=1&tab=edit",
  );
  for (const [index, source] of corpus.entries()) {
    const marker = `SYNTH-CORPUS-${index}`;
    await page.getByTestId("nb-editor-body").fill(source + "\n\n" + marker);
    const preview = page.getByTestId("nb-markdown");
    await expect(preview).toContainText(marker);
    await expect(preview).toHaveAttribute("aria-busy", "false");
    expect(
      await preview.locator("script,iframe,img,style,form,svg,math").count(),
    ).toBe(0);
    expect(
      await preview.locator('[href^="javascript:"],[href^="data:"]').count(),
    ).toBe(0);
    expect(
      await preview.evaluate((el) =>
        [...el.querySelectorAll("*")].some((n) =>
          [...n.attributes].some((a) => /^on/i.test(a.name)),
        ),
      ),
    ).toBe(false);
    await expect(page.getByTestId("nb-status-trust.verified")).toHaveCount(0);
  }
  expect(external).toEqual([]);
});
test("external links require explicit confirmation and unsent drafts survive route navigation", async ({
  page,
}) => {
  await page.goto(
    "/library/note/550e8400-e29b-41d4-a716-446655440000?demo=1&tab=edit",
  );
  await page
    .getByTestId("nb-editor-body")
    .fill("[Synthetic reference](https://example.invalid/path)");
  await page
    .getByTestId("nb-markdown")
    .getByRole("link", { name: "Synthetic reference opens confirmation" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Open an external link" }),
  ).toContainText("https://example.invalid/path");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("link", { name: "Settings & Privacy", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Knowledge Library", exact: true })
    .click();
  await page.getByRole("link", { name: "Vault notes", exact: true }).click();
  await page.getByRole("link", { name: "Preview with demo notes" }).click();
  await page
    .getByRole("link", { name: "A memory is only as useful as its evidence" })
    .click();
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page.getByTestId("nb-editor-body")).toHaveValue(
    "[Synthetic reference](https://example.invalid/path)",
  );
  await expect(page.getByTestId("nb-switch-propose-edit")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});
