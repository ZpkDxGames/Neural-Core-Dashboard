import { mkdir } from 'node:fs/promises';
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const noteId = "33333333-3333-4333-8333-333333333333",
  proposalId = "44444444-4444-4444-8444-444444444444",
  principal = "55555555-5555-4555-8555-555555555555",
  confirmedAt = new Date().toISOString();
const summary = {
  noteId,
  title: "SYNTH private note",
  type: "reference",
  revision: 1,
  tags: ["synthetic"],
  trust: "verified",
  verifiedBy: principal,
  verifiedAt: confirmedAt,
  updatedAt: confirmedAt,
  pending: false,
};
async function fixtures(page) {
  let consented = false;
  const calls = [];
  await page.route("**/api/auth/owner/session", (r) =>
    r.fulfill({
      json: {
        authenticated: true,
        provider: "google",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        csrf: "synthetic-csrf",
      },
    }),
  );
  await page.route("**/api/brain/v2/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.split("/v2/")[1];
    calls.push({ path, method: req.method() });
    let data;
    if (path === "consent") {
      expect(req.headers()["x-ncore-csrf"]).toBe("synthetic-csrf");
      consented = req.postDataJSON().granted;
      data = { consented, consentEpoch: 1 };
    } else if (path === "capability")
      data = {
        configured: true,
        consented,
        stepUpQualified: false,
        remoteSynchronization: false,
      };
    else if (!consented)
      return route.fulfill({
        status: 403,
        json: { error: "CONSENT_REQUIRED" },
      });
    else if (path === "notes")
      data = { items: [summary], partial: false, nextCursor: null };
    else if (path === "notes/" + noteId)
      data = {
        ...summary,
        body: "Synthetic **private content**. <script>window.__privateXss=1</script>",
        selfReported: { state: "proposed" },
        evidence: [
          {
            kind: "conversation",
            conversationId: "SYNTH source",
            messageId: "m1",
          },
        ],
        relations: [],
      };
    else if (path === "proposals")
      data = {
        items: [
          {
            proposal_id: proposalId,
            note_id: noteId,
            principal_id: principal,
            base_revision: 1,
            payload_hash: "a".repeat(64),
            state: "proposed",
            created_at: confirmedAt,
            author: {
              principal_id: principal,
              kind: "agent",
              role: "contributor",
              display_name: "SYNTH agent",
              scopes: ["read", "propose", "type:reference"],
            },
            payload: {
              title: "SYNTH proposed revision",
              body: "Unverified synthetic memory.",
              evidence: [
                {
                  kind: "conversation",
                  conversationId: "synthetic-source",
                  messageId: "m1",
                },
              ],
            },
          },
        ],
        partial: false,
        nextCursor: null,
      };
    else if (path === "review-challenges")
      data = { challengeId: proposalId, state: "fresh-auth-required" };
    else if (path.endsWith("/start"))
      return route.fulfill({
        status: 403,
        json: { error: "STEP_UP_UNAVAILABLE" },
      });
    else if(path === "agents") data=[{principal_id:principal,display_name:"SYNTH scoped agent",kind:"agent",role:"viewer",scopes:["read","type:reference"],credential_expires_at:new Date(Date.now()+3600000).toISOString()}];
    else if (path === "graph")
      data = { nodes: [summary], edges: [], partial: false, nextCursor: null };
    else
      return route.fulfill({
        status: 503,
        json: { error: "PRIVATE_CONNECTIVITY_UNAVAILABLE" },
      });
    return route.fulfill({ json: { schemaVersion: 3, confirmedAt, data } });
  });
  return { calls };
}
async function consent(page) {
  await page.goto("/settings?tab=sync");
  await page
    .getByLabel(
      "Allow remote memory reads and proposals for this owner session",
    )
    .check();
  await page
    .getByRole("button", { name: "Grant remote-memory consent" })
    .click();
  await expect(
    page.getByText("Remote memory access allowed for this owner session."),
  ).toBeVisible();
}
test("opt-in workspace sends no memory requests until explicit consent; revocation disconnects", async ({
  page,
}) => {
  const f = await fixtures(page);
  await page.goto("/settings?tab=sync");
  expect(f.calls).toEqual([]);
  await page
    .getByLabel(
      "Allow remote memory reads and proposals for this owner session",
    )
    .check();
  await page
    .getByRole("button", { name: "Grant remote-memory consent" })
    .click();
  await expect(
    page.getByText("Remote memory access allowed for this owner session."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Revoke remote-memory consent" })
    .click();
  await expect(page.getByText("Remote memory consent revoked.")).toBeVisible();
  await page
    .getByRole("link", { name: "Agent Workspace", exact: true })
    .click();
  await expect(page.getByText("Private memory disconnected")).toBeVisible();
  expect(f.calls.filter((c) => c.path === "proposals")).toHaveLength(0);
});
test("private note retrieval/evidence is inert, responsive and accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixtures(page);
  await consent(page);
  await page
    .getByRole("link", { name: "Knowledge Library", exact: true })
    .first()
    .click();
  await page.getByRole("link", { name: "Vault notes", exact: true }).click();
  await page.getByRole("link", { name: "SYNTH private note" }).click();
  await expect(
    page.getByText("source resolution unknown", { exact: false }),
  ).toBeVisible();
  await expect(page.getByTestId('nb-markdown')).toBeVisible();
  await expect(page.getByText('Backend · confirmed',{exact:true})).toBeVisible();
  expect(await page.evaluate(() => window.__privateXss)).toBeUndefined();
  await mkdir('docs/phase3/evidence',{recursive:true});await page.screenshot({path:'docs/phase3/evidence/private-note-mobile.png',fullPage:true});
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter((x) => ["serious", "critical"].includes(x.impact)),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("unqualified Google freshness preserves the proposal and never confirms a decision", async ({
  page,
}) => {
  await fixtures(page);
  await consent(page);
  await page
    .getByRole("link", { name: "Agent Workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "SYNTH proposed revision" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Verify with fresh Google authentication" })
    .click();
  await expect(
    page.getByText(
      "Fresh Google authentication is unavailable. The proposal is unchanged.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "SYNTH proposed revision" }),
  ).toBeVisible();
  await expect(page.getByText("Decision confirmed.")).toHaveCount(0);
});
test("private gateway failure is a failed state with local archive still available", async ({
  page,
}) => {
  await fixtures(page);
  await consent(page);
  await page.route("**/api/brain/v2/proposals**", (r) =>
    r.fulfill({
      status: 503,
      json: { error: "PRIVATE_CONNECTIVITY_UNAVAILABLE" },
    }),
  );
  await page
    .getByRole("link", { name: "Agent Workspace", exact: true })
    .click();
  await expect(
    page.getByText("Private request could not be confirmed."),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Knowledge Library", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("link", { name: "Local archive", exact: true }),
  ).toBeVisible();
});

test('private graph and registry expose confirmed nodes, evidence boundaries and credential expiry',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await fixtures(page);await consent(page);
 await page.getByRole('link',{name:'Knowledge Library',exact:true}).first().click();await page.getByRole('link',{name:'Vault notes',exact:true}).click();await page.getByRole('link',{name:'SYNTH private note'}).click();await page.getByRole('link',{name:'Inspect private graph'}).click();
 await expect(page.getByRole('heading',{name:'Private evidence graph'})).toBeVisible();await expect(page.locator('.nb-private-graph canvas')).toHaveCount(2);await expect(page.locator('.nb-private-graph canvas').first()).toBeVisible();await expect(page.getByRole('link',{name:'SYNTH private note',exact:true})).toBeVisible();
 const axe=await new AxeBuilder({page}).analyze();expect(axe.violations.filter(x=>['serious','critical'].includes(x.impact))).toEqual([]);await mkdir('docs/phase3/evidence',{recursive:true});await page.screenshot({path:'docs/phase3/evidence/private-graph-desktop.png',fullPage:true});
 await page.getByRole('link',{name:'Agent Workspace',exact:true}).click();await page.getByRole('link',{name:'Private identity registry',exact:true}).click();await expect(page.getByRole('heading',{name:'SYNTH scoped agent'})).toBeVisible();await expect(page.getByText('Credential expires ',{exact:false})).toBeVisible();
});
