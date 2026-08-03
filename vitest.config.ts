import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    coverage: {
      reporter: ["text", "html"],
      include: ["lib/isoxml/**/*.ts"],
      exclude: ["lib/isoxml/isoxml.worker.ts"],
    },
  },
});
