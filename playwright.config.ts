import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:18099", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm start",
    url: "http://127.0.0.1:18099/api/bootstrap",
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      NODE_ENV: "development",
      PORT: "18099",
      PI_HOME_AGENT_DATA_DIR: "E:\\TroyDev\\pi-ha-app\\.e2e-data",
      HOMEASSISTANT_CONFIG: "E:\\TroyDev\\pi-ha-app\\.e2e-config",
    },
  },
});
