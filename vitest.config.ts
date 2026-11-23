import { defineConfig } from "vitest/config";

// e2e/*.spec.ts는 Playwright Test가 돌리므로 Vitest에서는 tests/만 본다
export default defineConfig({ test: { include: ["tests/**/*.test.ts"] } });
