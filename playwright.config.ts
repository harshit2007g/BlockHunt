import { defineConfig } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 180_000,
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
  },
  webServer:
    process.env.EVENT_E2E === "1"
      ? {
          command:
            process.env.EVENT_TEST_BUILD === "1"
              ? "npm run start -- --hostname 127.0.0.1"
              : "npm run dev -- --hostname 127.0.0.1",
          url: "http://127.0.0.1:3000",
          reuseExistingServer: false,
          timeout: 120000,
        }
      : undefined,
});
