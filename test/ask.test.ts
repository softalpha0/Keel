import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compactDecisions, compactEvents, offlineAnswer, type AskContext } from "../src/ask/context.js";
import { runScenario } from "../src/sim/run.js";
import { demoScenario } from "../src/sim/scenario.js";

async function demoContext(): Promise<AskContext> {
  const s = demoScenario();
  const run = await runScenario(s);
  const names = Object.fromEntries(s.borrowers.map((b) => [b.id, b.name]));
  return {
    source: "simulated",
    reserveFloor: s.reserveFloor,
    weeks: run.reports.map((r) => ({ week: r.week, cash: r.platformBalance, floorHeld: r.floorHeld, reconciled: r.reconciled })),
    borrowers: s.borrowers.map((b) => ({ id: b.id, name: b.name })),
    decisions: compactDecisions(run.ledger.decisions, names),
    events: compactEvents(run.ledger.events),
  };
}

describe("Ask Keel without Claude (answers from the decision log)", () => {
  it("finds the decision the question is about", async () => {
    const ctx = await demoContext();
    expect(offlineAnswer("Why did you reallocate from Kopi to fund Nimbus?", ctx)).toMatch(/^Week 5, Nimbus Apparel: .*reallocate/);
    expect(offlineAnswer("Why was Nimbus declined in week 8?", ctx)).toMatch(/^Week 8, Nimbus Apparel: .*decline/);
    expect(offlineAnswer("Why was Kopi's pending advance withdrawn?", ctx)).toMatch(/^Week 6, Kopi Roasters: Re-checked/);
    expect(offlineAnswer("What happened with Ledgerly's late payment?", ctx)).toMatch(/Week 6: Ledgerly SaaS: .*not settled/);
    expect(offlineAnswer("How close did cash get to the reserve floor?", ctx)).toMatch(/reserve floor is \$30,000.*tightest point was week 5/);
  });
});

describe("POST /api/ask", () => {
  let server: Server;
  let seen: { body: Record<string, unknown>; headers: Record<string, unknown> } | undefined;
  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        seen = { body: JSON.parse(raw), headers: req.headers };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "Because of the floor." }], usage: { input_tokens: 1, output_tokens: 1 } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
  });
  afterAll(() => server.close());

  const ask = async (body: unknown, ip = "1.1.1.1") => {
    const { POST } = await import("../api/ask.js");
    return POST(new Request("http://x/api/ask", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }));
  };

  it("says it is not configured when there is no API key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await ask({ question: "why?", context: {} });
    expect(res.status).toBe(503);
  });

  it("answers through Claude with the run as context, and rejects oversized input", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const res = await ask({ question: "Why decline Nimbus?", context: { decisions: [{ week: 8 }] } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ answer: "Because of the floor.", by: "claude" });
    expect(seen!.body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", output_config: { effort: "low" } });
    expect(JSON.stringify(seen!.body.messages)).toContain('\\"week\\":8');

    expect((await ask({ question: "x".repeat(501), context: {} })).status).toBe(400);
    expect((await ask({ question: "ok", context: { blob: "x".repeat(90_000) } })).status).toBe(413);
  });

  it("rate-limits a single caller", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    const codes: number[] = [];
    for (let i = 0; i < 14; i++) codes.push((await ask({ question: "q", context: {} }, "9.9.9.9")).status);
    expect(codes.slice(0, 12).every((c) => c === 200)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });
});
