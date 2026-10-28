import { createHash } from "node:crypto";
import type { Cents } from "../domain.js";
import type { BalanceRow, BalanceSnapshot, BankAdapter, Conversion, ConversionRequest, Transfer, TransferRequest, TransferStatus } from "./types.js";
import type { WebhookHub } from "./webhooks.js";

/**
 * Airwallex sandbox adapter for Kit 7 (Portfolio Lending Agent).
 *
 * Follows the hackathon builder guide (airwallexdev.com):
 * - base URL https://api.sandbox.airwallex.com, paths under /api/v1
 * - bearer token from /authentication/login (30 minutes)
 * - amounts in MAJOR units: we convert from cents at this boundary only
 * - request_id is a UUID; reused only to retry the same operation
 * - platform -> borrower: connected_account_transfers/create; borrower -> platform: charges/create
 * - both return status NEW: poll until SETTLED
 * - borrower-scoped calls send x-on-behalf-of; platform calls use source/destination
 *
 * Fields marked VERIFY are not spelled out in the guide. Confirm them with the
 * airwallex-docs MCP server before the first live run.
 */
const API = {
  login: "/api/v1/authentication/login",
  balances: "/api/v1/balances/current",
  globalAccounts: "/api/v1/global_accounts",
  deposit: "/api/v1/simulation/deposit/create",
  disburse: "/api/v1/connected_account_transfers/create",
  disbursement: (id: string) => `/api/v1/connected_account_transfers/${id}`,
  disbursements: "/api/v1/connected_account_transfers",
  charge: "/api/v1/charges/create",
  chargeById: (id: string) => `/api/v1/charges/${id}`,
  charges: "/api/v1/charges",
  report: "/api/v1/platform_reports/create",
  reportById: (id: string) => `/api/v1/platform_reports/${id}`,
  fxRate: "/api/v1/fx/rates/current",
  convert: "/api/v1/fx/conversions/create",
};

export interface AirwallexConfig {
  baseUrl: string;
  clientId: string;
  apiKey: string;
  platformAccountId: string;
  currency: string;
  /** Namespaces request_ids so re-running the demo never collides with a previous run (7-day dedupe window). */
  runId: string;
  /** VERIFY: closed enum on both calls. Guide examples: professional_business_services, wages_salary. */
  disburseReason: string;
  collectReason: string;
  /** Optional borrower acct_ -> global account id, to skip the lookup. */
  globalAccounts?: Record<string, string>;
  /** When set, transfer and charge outcomes arrive by signed webhook; polling becomes the slow fallback. */
  webhooks?: WebhookHub;
}

export class AirwallexError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

const toMajor = (c: Cents) => Math.round(c) / 100;
const toCents = (major: number | string) => Math.round(Number(major) * 100);

/** Deterministic UUID from the run id and our own idempotency key: same operation, same request_id. */
export function requestId(runId: string, key: string): string {
  const h = createHash("sha256").update(`${runId}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Kind = "disburse" | "charge";

export class AirwallexBank implements BankAdapter {
  readonly name = "airwallex-sandbox";
  private token?: { value: string; expiresAt: number };
  private kinds = new Map<string, Kind>();
  private staged = new Set<string>();

  constructor(private cfg: AirwallexConfig) {}

  /** Attach a webhook listener after construction (the CLI starts it once it knows the port). */
  useWebhooks(hub: WebhookHub) {
    this.cfg.webhooks = hub;
  }

  static fromEnv(): AirwallexBank {
    const need = (k: string) => {
      const v = process.env[k];
      if (!v) throw new Error(`missing ${k} in .env (see .env.example)`);
      return v;
    };
    const ga = process.env.AIRWALLEX_GLOBAL_ACCOUNTS;
    return new AirwallexBank({
      baseUrl: process.env.AIRWALLEX_BASE_URL ?? "https://api.sandbox.airwallex.com",
      clientId: need("AIRWALLEX_CLIENT_ID"),
      apiKey: need("AIRWALLEX_API_KEY"),
      // Only used to tell platform calls from borrower calls; the platform itself never needs x-on-behalf-of.
      platformAccountId: process.env.AIRWALLEX_PLATFORM_ACCOUNT_ID || "platform",
      currency: process.env.AIRWALLEX_CURRENCY ?? "USD",
      runId: process.env.AIRWALLEX_RUN_ID ?? new Date().toISOString(),
      disburseReason: process.env.AIRWALLEX_DISBURSE_REASON ?? "professional_business_services",
      collectReason: process.env.AIRWALLEX_COLLECT_REASON ?? "professional_business_services",
      globalAccounts: ga ? Object.fromEntries(ga.split(",").map((p) => p.trim().split("=") as [string, string])) : undefined,
    });
  }

  get platformAccountId() {
    return this.cfg.platformAccountId;
  }

  get runId() {
    return this.cfg.runId;
  }

  // ---------- HTTP ----------

  private async auth(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    const res = await fetch(this.cfg.baseUrl + API.login, {
      method: "POST",
      headers: { "x-client-id": this.cfg.clientId, "x-api-key": this.cfg.apiKey },
    });
    if (!res.ok) throw new AirwallexError(res.status, undefined, `login failed (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as { token: string; expires_at?: string };
    this.token = { value: body.token, expiresAt: body.expires_at ? Date.parse(body.expires_at) : Date.now() + 25 * 60_000 };
    return body.token;
  }

  async call<T>(path: string, init: { method?: string; body?: unknown; onBehalfOf?: string } = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { Authorization: `Bearer ${await this.auth()}`, "Content-Type": "application/json" };
      if (init.onBehalfOf && init.onBehalfOf !== this.cfg.platformAccountId) headers["x-on-behalf-of"] = init.onBehalfOf;
      const method = init.method ?? (init.body !== undefined ? "POST" : "GET");
      const res = await fetch(this.cfg.baseUrl + path, {
        method,
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      // Sandbox rate limit: 10 req/s per endpoint. Back off instead of bursting.
      if (res.status === 429 && attempt < 4) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        let code: string | undefined;
        try {
          code = (JSON.parse(text) as { code?: string }).code;
        } catch {
          /* non-JSON error body */
        }
        throw new AirwallexError(res.status, code, `${method} ${path} -> ${res.status} ${text}`);
      }
      return (text ? JSON.parse(text) : {}) as T;
    }
  }

  // ---------- BankAdapter ----------

  async getBalance(accountId: string, currency = this.cfg.currency): Promise<Cents> {
    const rows = await this.call<{ currency: string; available_amount: number }[]>(API.balances, { onBehalfOf: accountId });
    return toCents(rows.find((r) => r.currency === currency)?.available_amount ?? 0);
  }

  async transfer(req: TransferRequest): Promise<Transfer> {
    const kind: Kind = req.fromAccountId === this.cfg.platformAccountId ? "disburse" : "charge";
    const rid = requestId(this.cfg.runId, req.idempotencyKey);
    const body =
      kind === "disburse"
        ? { request_id: rid, amount: toMajor(req.amount), currency: req.currency ?? this.cfg.currency, destination: req.toAccountId, reason: this.cfg.disburseReason, reference: req.reference.slice(0, 140) }
        : { request_id: rid, amount: toMajor(req.amount), currency: req.currency ?? this.cfg.currency, source: req.fromAccountId, reason: this.cfg.collectReason, reference: req.reference.slice(0, 140) };

    let id: string;
    try {
      const created = await this.call<{ id: string }>(kind === "disburse" ? API.disburse : API.charge, { body });
      id = created.id;
    } catch (err) {
      // Any failure is ambiguous: it may have been created. Look it up by request_id before anyone retries.
      const found = await this.findByRequestId(kind, rid);
      if (!found) throw err;
      id = found;
    }
    this.kinds.set(id, kind);
    return this.waitForTerminal(id, req);
  }

  async getTransfer(id: string): Promise<Transfer> {
    const kind = this.kinds.get(id) ?? "disburse";
    const t = await this.call<{ id: string; status: string; amount: number; request_id: string }>(kind === "disburse" ? API.disbursement(id) : API.chargeById(id));
    return { id: t.id, status: mapStatus(t.status), amount: toCents(t.amount), idempotencyKey: t.request_id };
  }

  /** Sandbox only: customer revenue lands in the borrower's global account. */
  async stageRevenue(accountId: string, amount: Cents, idempotencyKey: string, currency = this.cfg.currency): Promise<void> {
    if (this.staged.has(idempotencyKey) || this.stagedStore?.has(idempotencyKey)) return; // the deposit simulation takes no request_id
    const globalAccountId = await this.globalAccountFor(accountId, currency);
    await this.call(API.deposit, { onBehalfOf: accountId, body: { global_account_id: globalAccountId, amount: toMajor(amount), payer_name: "Customer revenue" } });
    this.staged.add(idempotencyKey);
    this.stagedStore?.add(idempotencyKey);
  }

  /**
   * Deposit simulations cannot be deduplicated by Airwallex, so remember what was staged on disk.
   * Re-running the same AIRWALLEX_RUN_ID after a crash then never deposits the same week twice.
   */
  stagedStore?: { has(key: string): boolean; add(key: string): void };

  async fxRate(sell: string, buy: string): Promise<number> {
    if (sell === buy) return 1;
    // Quote a fixed sell amount and derive the rate from the amounts, so the direction of `rate` never matters.
    const q = await this.call<{ rate?: number; rate_details?: { buy_amount?: number; sell_amount?: number }[] }>(
      `${API.fxRate}?sell_currency=${sell}&buy_currency=${buy}&sell_amount=10000`,
    );
    const d = q.rate_details?.find((x) => x.buy_amount && x.sell_amount);
    const rate = d ? d.buy_amount! / d.sell_amount! : q.rate;
    if (!rate || !Number.isFinite(rate)) throw new Error(`no ${sell}/${buy} rate in quote`);
    return rate;
  }

  async convert(req: ConversionRequest): Promise<Conversion> {
    const rid = requestId(this.cfg.runId, req.idempotencyKey);
    const c = await this.call<{ conversion_id?: string; id?: string; buy_amount: number; sell_amount: number; client_rate?: number }>(API.convert, {
      onBehalfOf: req.accountId,
      body: { request_id: rid, sell_currency: req.sellCurrency, buy_currency: req.buyCurrency, sell_amount: String(toMajor(req.sellAmount)) },
    });
    const buyAmount = toCents(c.buy_amount);
    return { id: c.conversion_id ?? c.id ?? rid, sellAmount: toCents(c.sell_amount), buyAmount, rate: c.client_rate ?? buyAmount / req.sellAmount };
  }

  /**
   * The bank's own view of every wallet: request a BALANCE_REPORT, wait for it, download the CSV
   * (the link lives for one minute) and parse it.
   */
  async balanceSnapshot(timeoutMs = 180_000): Promise<BalanceSnapshot> {
    const created = await this.createBalanceReport();
    if (!created.id) throw new Error("BALANCE_REPORT returned no id");
    const started = Date.now();
    for (;;) {
      const r = await this.call<{ status?: string; download_url?: string; failed_reason?: string }>(API.reportById(created.id));
      const status = (r.status ?? "").toUpperCase();
      if (status === "FAILED") throw new Error(`BALANCE_REPORT failed: ${r.failed_reason ?? "no reason given"}`);
      if (status === "COMPLETED" && r.download_url) {
        const res = await fetch(r.download_url);
        if (!res.ok) throw new Error(`report download failed (${res.status})`);
        return { reportId: created.id, rows: parseBalanceCsv(await res.text()) };
      }
      if (Date.now() - started > timeoutMs) throw new Error(`BALANCE_REPORT ${created.id} still ${status || "pending"} after ${timeoutMs / 1000}s`);
      await sleep(3_000);
    }
  }

  /** Portfolio snapshot for reconciliation (Kit 7). Download the file within 60 seconds of the link appearing. */
  async createBalanceReport(): Promise<{ id?: string; status?: string }> {
    const r = await this.call<{ id?: string; report_id?: string; status?: string }>(API.report, {
      body: { type: "BALANCE_REPORT", file_format: "CSV" },
    });
    return { id: r.id ?? r.report_id, status: r.status };
  }

  // ---------- helpers ----------

  private async waitForTerminal(id: string, req: TransferRequest): Promise<Transfer> {
    const started = Date.now();
    const hub = this.cfg.webhooks;
    // With webhooks the signed event is the primary signal; a slow poll stays as the safety net.
    const pollEvery = hub ? 5_000 : 1_000;
    const event = hub?.waitFor(id);
    for (;;) {
      const t = await this.getTransfer(id);
      if (t.status !== "pending") return { ...t, idempotencyKey: req.idempotencyKey, confirmedBy: "poll" };
      if (Date.now() - started > 90_000) return { ...t, idempotencyKey: req.idempotencyKey, confirmedBy: "poll" };
      const heard = event ? await Promise.race([event, sleep(pollEvery).then(() => undefined)]) : (await sleep(pollEvery), undefined);
      if (heard && heard !== "pending") {
        // Trust but verify: read the object back so the amount and status come from the API, not the event body.
        const confirmed = await this.getTransfer(id);
        if (confirmed.status !== "pending") return { ...confirmed, idempotencyKey: req.idempotencyKey, confirmedBy: "webhook" };
      }
    }
  }

  private async findByRequestId(kind: Kind, rid: string): Promise<string | undefined> {
    // Whether the list endpoints filter by request_id is undocumented (asked Airwallex), so filter
    // client-side and walk a few pages: a recent transfer is near the front of the list.
    for (let page = 0; page < 5; page++) {
      try {
        const res = await this.call<{ items?: { id: string; request_id?: string }[]; has_more?: boolean }>(
          `${kind === "disburse" ? API.disbursements : API.charges}?request_id=${rid}&page_num=${page}&page_size=100`,
        );
        const hit = res.items?.find((i) => i.request_id === rid)?.id;
        if (hit) return hit;
        if (!res.has_more) return undefined;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private async globalAccountFor(accountId: string, currency = this.cfg.currency): Promise<string> {
    const known = this.cfg.globalAccounts?.[currency === this.cfg.currency ? accountId : `${accountId}:${currency}`];
    if (known) return known;
    const list = await this.call<{ items?: { id: string; currency?: string; required_features?: { currency: string }[] }[] }>(API.globalAccounts, {
      onBehalfOf: accountId,
    });
    const match =
      list.items?.find((g) => g.currency === currency || g.required_features?.some((f) => f.currency === currency)) ??
      (currency === this.cfg.currency ? list.items?.[0] : undefined);
    if (!match) throw new Error(`no ${currency} global account for ${accountId}; run npm run sandbox:setup${currency === this.cfg.currency ? "" : " -- --fx"}`);
    (this.cfg.globalAccounts ??= {})[currency === this.cfg.currency ? accountId : `${accountId}:${currency}`] = match.id;
    return match.id;
  }
}

function mapStatus(s: string): TransferStatus {
  const v = s.toUpperCase();
  if (v === "SETTLED" || v === "PAID" || v === "SUCCEEDED") return "settled";
  if (["FAILED", "CANCELLED", "REJECTED", "RETURNED"].includes(v)) return "failed";
  return "pending"; // NEW, PROCESSING, PENDING, SENT ...
}

/** Parses Airwallex's BALANCE_REPORT CSV (account_id, currency, available_balance, total_balance, ...). */
export function parseBalanceCsv(csv: string): BalanceRow[] {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (l: string) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const head = split(lines[0]!).map((h) => h.toLowerCase());
  const col = (name: string) => head.indexOf(name);
  const [acc, ccy, avail, total, updated] = [col("account_id"), col("currency"), col("available_balance"), col("total_balance"), col("last_update")];
  if (acc < 0 || ccy < 0 || avail < 0) throw new Error(`unexpected BALANCE_REPORT columns: ${head.join(", ")}`);
  return lines.slice(1).map((l) => {
    const c = split(l);
    return {
      accountId: c[acc]!,
      currency: c[ccy]!,
      available: toCents(c[avail]!),
      total: toCents(c[total >= 0 ? total : avail]!),
      ...(updated >= 0 && c[updated] ? { lastUpdate: c[updated] } : {}),
    };
  });
}
