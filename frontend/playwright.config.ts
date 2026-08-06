import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { baseURL: "http://127.0.0.1:4178", locale: "zh-CN", trace: "retain-on-failure" },
  webServer: {
    command: "npm run preview",
    url: "http://127.0.0.1:4178",
    reuseExistingServer: true,
    timeout: 60_000
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }]
});
