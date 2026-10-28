import { randomBytes, timingSafeEqual } from "node:crypto";

export interface PendingDecision {
  id: string;
  title: string;
  detail: string;
}

type Outcome = { approved: boolean; by: string };

/**
 * Holds decisions waiting for a person. Each gets an unguessable token; the approval link
 * opens a confirmation page and only a POST from that page decides, so link previews and
 * crawlers can never approve anything.
 */
export class ApprovalDesk {
  private pending = new Map<string, PendingDecision & { token: string; resolve: (o: Outcome) => void; timer: NodeJS.Timeout }>();

  open(d: PendingDecision, timeoutMs: number, onTimeout: () => void): { token: string; result: Promise<Outcome> } {
    const token = randomBytes(18).toString("base64url");
    const result = new Promise<Outcome>((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(d.id)) return;
        onTimeout();
        resolve({ approved: false, by: "timeout" });
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(d.id, { ...d, token, resolve, timer });
    });
    return { token, result };
  }

  /** Answers GET (confirmation page) and POST (the decision) for /approve/:id. */
  handle(method: string, url: URL, form?: URLSearchParams): { status: number; html: string } {
    const id = decodeURIComponent(url.pathname.split("/")[2] ?? "");
    const p = this.pending.get(id);
    const token = (form?.get("token") ?? url.searchParams.get("token")) || "";
    if (!p || !sameToken(p.token, token)) return { status: 404, html: page("Nothing to decide", "This decision was already made, expired, or the link is wrong.") };
    const decision = (form?.get("decision") ?? url.searchParams.get("decision")) === "approve" ? "approve" : "reject";

    if (method === "GET") {
      return {
        status: 200,
        html: page(
          p.title,
          `<p>${esc(p.detail)}</p>
           <form method="post"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="decision" value="${decision}">
           <button class="${decision}">${decision === "approve" ? "Approve and execute" : "Reject"}</button></form>`,
        ),
      };
    }
    this.pending.delete(id);
    clearTimeout(p.timer);
    p.resolve({ approved: decision === "approve", by: "slack" });
    return { status: 200, html: page(decision === "approve" ? "Approved ✓" : "Rejected", "Keel has your answer. You can close this tab.") };
  }
}

const sameToken = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function page(title: string, body: string) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Keel · ${esc(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:12vh auto;padding:0 16px;color:#111;background:#f9f9f7}
h1{font-size:24px;letter-spacing:-.02em}button{font:600 15px system-ui;padding:12px 18px;border:0;border-radius:10px;cursor:pointer;color:#fff}
.approve{background:#2f7be0}.reject{background:#444}</style><h1>${esc(title)}</h1>${body.startsWith("<") ? body : `<p>${esc(body)}</p>`}`;
}
