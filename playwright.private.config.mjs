import base from "./playwright.config.mjs";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  ...base,
  testDir: "./tests/private-browser",
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: "docs/phase3/evidence/private-browser-results.json" },
    ],
  ],
  webServer: {
    ...base.webServer,
    env: {
      NCORE_OWNER_AUTH_ENABLED: "0",
      NCORE_BRAIN_PRIVATE_ENABLED: "1",
      NCORE_PRIVATE_STAGING_CERTIFIED: "1",
    },
  },
});
