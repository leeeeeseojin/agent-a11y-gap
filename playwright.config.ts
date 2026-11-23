import { defineConfig } from "@playwright/test";

const PORT = 4311;

export default defineConfig({
  testDir: "e2e",
  // 수집기와 같은 브라우저(설치된 Chrome 안정판)로 사람 기준을 잰다
  use: { channel: "chrome", headless: true, baseURL: `http://127.0.0.1:${PORT}` },
  webServer: {
    command: "npx tsx probe/serve.ts",
    env: { PORT: String(PORT) },
    url: `http://127.0.0.1:${PORT}/modal/`,
    reuseExistingServer: !process.env.CI,
  },
});
