import { createHash } from "node:crypto";
import type { Cents } from "../domain.js";
import type { BankAdapter, Transfer, TransferRequest, TransferStatus } from "./types.js";

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

  async getBalance(accountId: string): Promise<Cents> {
    const rows = await this.call<{ currency: string; available_amount: number }[]>(API.balances, { onBehalfOf: accountId });
    return toCents(rows.find((r) => r.currency === this.cfg.currency)?.available_amount ?? 0);
  }

  async transfer(req: TransferRequest): Promise<Transfer> {
    const kind: Kind = req.fromAccountId === this.cfg.platformAccountId ? "disburse" : "charge";
    const rid = requestId(this.cfg.runId, req.idempotencyKey);
    const body =
      kind === "disburse"
        ? { request_id: rid, amount: toMajor(req.amount), currency: this.cfg.currency, destination: req.toAccountId, reason: this.cfg.disburseReason, reference: req.reference.slice(0, 140) }
        : { request_id: rid, amount: toMajor(req.amount), currency: this.cfg.currency, source: req.fromAccountId, reason: this.cfg.collectReason, reference: req.reference.slice(0, 140) };

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
  async stageRevenue(accountId: string, amount: Cents, idempotencyKey: string): Promise<void> {
    if (this.staged.has(idempotencyKey)) return; // the deposit simulation takes no request_id
    const globalAccountId = await this.globalAccountFor(accountId);
    await this.call(API.deposit, { onBehalfOf: accountId, body: { global_account_id: globalAccountId, amount: toMajor(amount), payer_name: "Customer revenue" } });
    this.staged.add(idempotencyKey);
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
    for (;;) {
      const t = await this.getTransfer(id);
      if (t.status !== "pending") return { ...t, idempotencyKey: req.idempotencyKey };
      if (Date.now() - started > 60_000) return { ...t, idempotencyKey: req.idempotencyKey };
      await sleep(1_000);
    }
  }

  private async findByRequestId(kind: Kind, rid: string): Promise<string | undefined> {
    try {
      // VERIFY: whether the list endpoints filter by request_id; we filter client-side either way.
      const page = await this.call<{ items?: { id: string; request_id?: string }[] }>(
        `${kind === "disburse" ? API.disbursements : API.charges}?request_id=${rid}&page_size=100`,
      );
      return page.items?.find((i) => i.request_id === rid)?.id;
    } catch {
      return undefined;
    }
  }

  private async globalAccountFor(accountId: string): Promise<string> {
    const known = this.cfg.globalAccounts?.[accountId];
    if (known) return known;
    const list = await this.call<{ items?: { id: string; currency?: string; required_features?: { currency: string }[] }[] }>(API.globalAccounts, {
      onBehalfOf: accountId,
    });
    const match =
      list.items?.find((g) => g.currency === this.cfg.currency || g.required_features?.some((f) => f.currency === this.cfg.currency)) ?? list.items?.[0];
    if (!match) throw new Error(`no global account for ${accountId}; run npm run sandbox:setup`);
    (this.cfg.globalAccounts ??= {})[accountId] = match.id;
    return match.id;
  }
}

function mapStatus(s: string): TransferStatus {
  const v = s.toUpperCase();
  if (v === "SETTLED" || v === "PAID" || v === "SUCCEEDED") return "settled";
  if (["FAILED", "CANCELLED", "REJECTED", "RETURNED"].includes(v)) return "failed";
  return "pending"; // NEW, PROCESSING, PENDING, SENT ...
}
