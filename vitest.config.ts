import { defineConfig } from "vitest/config";

// Separate from vite.config.ts, whose root is the web app.
// The property test (2,000 portfolios) and the first import of the Anthropic SDK can take
// well over vitest's 5s default on a busy laptop, so allow 60s per test.
export default defineConfig({
  test: { root: ".", include: ["test/**/*.test.ts"], testTimeout: 60_000 },
});