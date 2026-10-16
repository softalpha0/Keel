import { defineConfig } from "vitest/config";

// Separate from vite.config.ts, whose root is the web app.
export default defineConfig({
  test: { root: ".", include: ["test/**/*.test.ts"] },
});
