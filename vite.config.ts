import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Serves api/ask.ts under `npm run dev` and `npm run preview`, the same handler Vercel runs in production,
 * so Ask Keel works locally with ANTHROPIC_API_KEY from .env.
 */
function localApi(): Plugin {
  const mount = (server: { middlewares: ViteDevServer["middlewares"] }, load: () => Promise<{ POST: (r: Request) => Promise<Response> }>) =>
    server.middlewares.use("/api/ask", (req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", async () => {
        try {
          const mod = await load();
          const out = await mod.POST(
            new Request("http://localhost/api/ask", {
              method: req.method,
              headers: { "content-type": "application/json", "x-forwarded-for": req.socket.remoteAddress ?? "local" },
              body: req.method === "POST" ? raw : undefined,
            }),
          );
          res.statusCode = out.status;
          res.setHeader("Content-Type", "application/json");
          res.end(await out.text());
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
    });
  let dev: ViteDevServer | undefined;
  return {
    name: "keel-local-api",
    configureServer(server) {
      dev = server;
      mount(server, () => server.ssrLoadModule(resolve(import.meta.dirname, "api/ask.ts")) as never);
    },
    async configurePreviewServer(server) {
      const { createServer } = await import("vite");
      mount(server, async () => {
        dev ??= await createServer({ configFile: false, root: import.meta.dirname, server: { middlewareMode: true }, appType: "custom" });
        return dev.ssrLoadModule(resolve(import.meta.dirname, "api/ask.ts")) as never;
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Make .env (ANTHROPIC_API_KEY) visible to the local /api/ask handler. Nothing is exposed to the browser.
  Object.assign(process.env, { ...loadEnv(mode, import.meta.dirname, ""), ...process.env });
  return {
    root: "web",
    plugins: [react(), localApi()],
    build: { outDir: "../dist/web", emptyOutDir: true },
    server: { port: 5173 },
    preview: { port: 4173 },
  };
});
