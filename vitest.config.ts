import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(ROOT, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/mock/index.ts"],
  },
});
