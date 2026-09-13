import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["apps/api/src/**/*.test.ts", "apps/web/src/**/*.test.tsx", "packages/**/*.test.ts"],
    setupFiles: ["apps/web/src/test-setup.ts"],
  },
});
