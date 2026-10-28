import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AirwallexBank, requestId } from "../src/bank/airwallex.js";
import { signForTest, WebhookHub } from "../src/bank/webhooks.js";

/** A tiny fake of the Airwallex sandbox, following the builder guide's conventions. */
interface Seen {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown> | undefined;
}

let server: Server;
let base = "";
const seen: Seen[] = [];
const objects = new Map<string, { id: string; request_id: string; amount: number; status: string; polls: number }>();
let failNextCreateAfterSaving = false;
/** When set, created objects stay NEW until a webhook settles them. */
let holdForWebhook = false;
let reportPolls = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      const url = new URL(req.url!, "http://x");
      seen.push({ method: req.method!, path: url.pathname, headers: req.headers, body });
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (url.pathname === "/api/v1/authentication/login") return send(201, { token: "tkn", expires_at: new Date(Date.now() + 1_800_000).toISOString() });
      // Signed download links need no bearer token, like Airwallex's.
      if (url.pathname === "/files/rpt_1.csv") {
        res.writeHead(200, { "Content-Type": "text/csv" });
        return res.end("account_id,currency,available_balance,reserved_balance,total_balance,last_update\nacct_kopi,USD,1234.5,0,1234.5,2026-10-28\n");
      }
      if (req.headers.authorization !== "Bearer tkn") return send(401, { code: "unauthorized" });
      if (url.pathname === "/api/v1/balances/current") {
        return send(200, [{ currency: "USD", available_amount: req.headers["x-on-behalf-of"] ? 1234.5 : 100000 }]);
      }
      const create = url.pathname.match(/^\/api\/v1\/(charges|connected_account_transfers)\/create$/);
      if (create) {
        const id = `${create[1] === "charges" ? "chg" : "cat"}_${objects.size + 1}`;
        objects.set(id, { id, request_id: body.request_id, amount: body.amount, status: "NEW", polls: holdForWebhook ? -1e9 : 0 });
        if (failNextCreateAfterSaving) {
          failNextCreateAfterSaving = false;
          return send(502, { code: "bad_gateway" }); // created, but the caller never learns the id
        }
        return send(201, { id, status: "NEW" });
      }
      const get = url.pathname.match(/^\/api\/v1\/(charges|connected_account_transfers)\/([a-z]+_\d+)$/);
      if (get) {
        const o = objects.get(get[2]!)!;
        o.polls++;
        if (o.polls >= 2) o.status = "SETTLED";
        return send(200, o);
      }
      if (url.pathname === "/api/v1/platform_reports/create") return send(201, { id: "rpt_1", status: "PENDING" });
      if (url.pathname === "/api/v1/platform_reports/rpt_1") {
        return send(200, ++reportPolls < 2 ? { id: "rpt_1", status: "PENDING" } : { id: "rpt_1", status: "COMPLETED", download_url: `${base}/files/rpt_1.csv` });
      }
      if (url.pathname === "/api/v1/fx/rates/current") {
        // `rate` quoted in the other direction on purpose: Keel must derive the rate from the amounts.
        return send(200, { rate: 1.3514, currency_pair: "USDSGD", rate_details: [{ level: "INSTANT", buy_amount: 7400, sell_amount: 10000 }] });
      }
      if (url.pathname === "/api/v1/fx/conversions/create") {
        return send(201, { conversion_id: "conv_1", request_id: body.request_id, sell_amount: Number(body.sell_amount), buy_amount: Number(body.sell_amount) * 0.74, client_rate: 0.74, status: "SCHEDULED" });
      }
      const list = url.pathname.match(/^\/api\/v1\/(charges|connected_account_transfers)$/);
      if (list) return send(200, { items: [...objects.values()] });
      send(404, { code: "not_found" });
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

const bank = () =>
  new AirwallexBank({
    baseUrl: base,
    clientId: "cid",
    apiKey: "key",
    platformAccountId: "platform",
    currency: "USD",
    runId: "run-1",
    disburseReason: "professional_business_services",
    collectReason: "professional_business_services",
  });

describe("AirwallexBank against a fake sandbox", () => {
  it("reads balances in major units and scopes borrower reads with x-on-behalf-of", async () => {
    const b = bank();
    expect(await b.getBalance("acct_kopi")).toBe(123_450);
    const call = seen.filter((s) => s.path === "/api/v1/balances/current").at(-1)!;
    expect(call.headers["x-on-behalf-of"]).toBe("acct_kopi");
    expect(await b.getBalance("platform")).toBe(10_000_000);
    expect(seen.filter((s) => s.path === "/api/v1/balances/current").at(-1)!.headers["x-on-behalf-of"]).toBeUndefined();
  });

  it("disburses with connected_account_transfers in major units and polls NEW until SETTLED", async () => {
    const t = await bank().transfer({ fromAccountId: "platform", toAccountId: "acct_nimbus", amount: 2_600_000, idempotencyKey: "disburse:req:req_3", reference: "Advance adv_3" });
    expect(t.status).toBe("settled");
    const create = seen.find((s) => s.path === "/api/v1/connected_account_transfers/create")!;
    expect(create.body).toMatchObject({ amount: 26000, currency: "USD", destination: "acct_nimbus", reason: "professional_business_services", reference: "Advance adv_3" });
    expect(create.body!.request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("collects with charges/create using the borrower as source", async () => {
    await bank().transfer({ fromAccountId: "acct_kopi", toAccountId: "platform", amount: 90_050, idempotencyKey: "collect:adv_1:w4", reference: "Repayment" });
    const create = seen.filter((s) => s.path === "/api/v1/charges/create").at(-1)!;
    expect(create.body).toMatchObject({ amount: 900.5, source: "acct_kopi" });
  });

  it("finds the transfer by request_id when the create response is lost, instead of creating a second one", async () => {
    failNextCreateAfterSaving = true;
    const before = [...objects.values()].length;
    const t = await bank().transfer({ fromAccountId: "acct_kopi", toAccountId: "platform", amount: 50_000, idempotencyKey: "collect:adv_1:w6", reference: "Repayment" });
    expect(t.status).toBe("settled");
    expect([...objects.values()].length).toBe(before + 1);
  });

  it("derives the same request_id for the same operation, and a new one per run", () => {
    expect(requestId("run-1", "collect:adv_1:w6")).toBe(requestId("run-1", "collect:adv_1:w6"));
    expect(requestId("run-2", "collect:adv_1:w6")).not.toBe(requestId("run-1", "collect:adv_1:w6"));
    expect(requestId("run-1", "x").length).toBe(36);
  });

  it("requests a BALANCE_REPORT for the portfolio snapshot", async () => {
    expect(await bank().createBalanceReport()).toEqual({ id: "rpt_1", status: "PENDING" });
    expect(seen.find((s) => s.path === "/api/v1/platform_reports/create")!.body).toEqual({ type: "BALANCE_REPORT", file_format: "CSV" });
  });

  it("downloads and parses the BALANCE_REPORT once it completes", async () => {
    const snap = await bank().balanceSnapshot();
    expect(snap).toEqual({ reportId: "rpt_1", rows: [{ accountId: "acct_kopi", currency: "USD", available: 123_450, total: 123_450 }] });
    expect(reportPolls).toBe(2);
  });

  it("quotes FX from the amounts and converts with a request_id", async () => {
    const b = bank();
    expect(await b.fxRate("SGD", "USD")).toBeCloseTo(0.74, 6);
    const c = await b.convert({ accountId: "platform", sellCurrency: "SGD", buyCurrency: "USD", sellAmount: 100_000, idempotencyKey: "fx:collect:adv_1:w4" });
    expect(c).toEqual({ id: "conv_1", sellAmount: 100_000, buyAmount: 74_000, rate: 0.74 });
    const sent = seen.find((s) => s.path === "/api/v1/fx/conversions/create")!;
    expect(sent.body).toMatchObject({ sell_currency: "SGD", buy_currency: "USD", sell_amount: "1000", request_id: requestId("run-1", "fx:collect:adv_1:w4") });
  });

  it("learns a transfer settled from a signed webhook, then reads it back to confirm", async () => {
    const hub = new WebhookHub("whsec");
    const b = bank();
    b.useWebhooks(hub);
    holdForWebhook = true;
    setTimeout(() => {
      const o = [...objects.values()].at(-1)!;
      o.status = "SETTLED";
      const raw = JSON.stringify({ id: "evt_1", name: "connected_account_transfer.settled", data: { id: o.id, status: "SETTLED" } });
      hub.handle(raw, signForTest("whsec", raw));
    }, 300);
    const t0 = Date.now();
    const t = await b.transfer({ fromAccountId: "platform", toAccountId: "acct_x", amount: 100_00, idempotencyKey: "disburse:req:wh", reference: "Advance" });
    holdForWebhook = false;
    expect(t).toMatchObject({ status: "settled", confirmedBy: "webhook" });
    expect(Date.now() - t0).toBeLessThan(3_000);
  });
});
