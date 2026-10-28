import { createServer, type Server } from "node:http";
import type { WebhookHub } from "../bank/webhooks.js";
import type { ApprovalDesk } from "../approvals/desk.js";

/**
 * One small HTTP server for the things that call Keel back:
 *   POST /webhooks/airwallex   signed Airwallex events
 *   GET|POST /approve/:id      approval links from Slack
 * Run it behind a tunnel (e.g. `cloudflared tunnel --url http://localhost:8788`) so Airwallex can reach it.
 */
export function startLocalServer(opts: { port: number; hub?: WebhookHub; desk?: ApprovalDesk }): Promise<Server> {
  const server = createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "POST" && url.pathname === "/webhooks/airwallex" && opts.hub) {
        res.writeHead(opts.hub.handle(raw, req.headers)).end();
        return;
      }
      if (url.pathname.startsWith("/approve/") && opts.desk && (req.method === "GET" || req.method === "POST")) {
        const r = opts.desk.handle(req.method, url, req.method === "POST" ? new URLSearchParams(raw) : undefined);
        res.writeHead(r.status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(r.html);
        return;
      }
      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
        return;
      }
      res.writeHead(404).end();
    });
  });
  return new Promise((resolve) => server.listen(opts.port, () => resolve(server)));
}
