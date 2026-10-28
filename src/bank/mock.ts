import { PLATFORM_CURRENCY, type Cents } from "../domain.js";
import type { BalanceSnapshot, BankAdapter, Conversion, ConversionRequest, Transfer, TransferRequest } from "./types.js";

const wallet = (accountId: string, currency = PLATFORM_CURRENCY) => `${accountId}|${currency}`;

/**
 * In-memory bank with real idempotency semantics and fault injection,
 * so the demo can show a lost response being retried without double-moving money.
 * Wallets are per account and currency, like Airwallex.
 */
export class MockBank implements BankAdapter {
  readonly name = "mock";
  private balances = new Map<string, Cents>();
  private transfers = new Map<string, Transfer>();
  private byKey = new Map<string, Transfer>();
  private conversions = new Map<string, Conversion>();
  private rates = new Map<string, number>();
  private stagedKeys = new Set<string>();
  private faults: { match: (r: TransferRequest) => boolean; mode: "lost-response" | "reject" }[] = [];
  private seq = 0;
  /** Count of transfer calls that actually moved money. Tests use it to prove no double-pay. */
  appliedTransfers = 0;

  /** `initial` is in the platform currency; use `fund()` for other wallets. */
  constructor(initial: Record<string, Cents> = {}) {
    for (const [id, bal] of Object.entries(initial)) this.balances.set(wallet(id), bal);
  }

  fund(accountId: string, currency: string, amount: Cents) {
    this.balances.set(wallet(accountId, currency), (this.balances.get(wallet(accountId, currency)) ?? 0) + amount);
  }

  /** Units of `buy` per unit of `sell`. The simulation moves it week to week. */
  setRate(sell: string, buy: string, rate: number) {
    this.rates.set(`${sell}/${buy}`, rate);
  }

  /** Next matching transfer settles but the caller sees a network error (the classic double-pay trap). */
  injectLostResponse(match: (r: TransferRequest) => boolean) {
    this.faults.push({ match, mode: "lost-response" });
  }

  injectReject(match: (r: TransferRequest) => boolean) {
    this.faults.push({ match, mode: "reject" });
  }

  async getBalance(accountId: string, currency?: string): Promise<Cents> {
    return this.balances.get(wallet(accountId, currency)) ?? 0;
  }

  async transfer(req: TransferRequest): Promise<Transfer> {
    if (req.amount <= 0) throw new Error("amount must be positive");
    const existing = this.byKey.get(req.idempotencyKey);
    if (existing) {
      if (existing.amount !== req.amount) throw new Error(`idempotency key reused with different amount: ${req.idempotencyKey}`);
      return existing;
    }

    const faultIdx = this.faults.findIndex((f) => f.match(req));
    const fault = faultIdx >= 0 ? this.faults.splice(faultIdx, 1)[0] : undefined;
    if (fault?.mode === "reject") throw new Error("bank rejected transfer (injected)");

    const src = wallet(req.fromAccountId, req.currency);
    const dst = wallet(req.toAccountId, req.currency);
    const from = this.balances.get(src) ?? 0;
    const t: Transfer = { id: `tr_${++this.seq}`, status: "settled", amount: req.amount, idempotencyKey: req.idempotencyKey, confirmedBy: "poll" };
    if (from < req.amount) {
      t.status = "failed";
    } else {
      this.balances.set(src, from - req.amount);
      this.balances.set(dst, (this.balances.get(dst) ?? 0) + req.amount);
      this.appliedTransfers++;
    }
    this.transfers.set(t.id, t);
    this.byKey.set(req.idempotencyKey, t);

    if (fault?.mode === "lost-response") throw new Error("ETIMEDOUT: response lost after transfer settled (injected)");
    return t;
  }

  async getTransfer(id: string): Promise<Transfer> {
    const t = this.transfers.get(id);
    if (!t) throw new Error(`unknown transfer ${id}`);
    return t;
  }

  async stageRevenue(accountId: string, amount: Cents, idempotencyKey: string, currency?: string): Promise<void> {
    if (this.stagedKeys.has(idempotencyKey)) return;
    this.stagedKeys.add(idempotencyKey);
    this.fund(accountId, currency ?? PLATFORM_CURRENCY, amount);
  }

  async fxRate(sell: string, buy: string): Promise<number> {
    if (sell === buy) return 1;
    const r = this.rates.get(`${sell}/${buy}`);
    if (!r) throw new Error(`no rate for ${sell}/${buy}`);
    return r;
  }

  async convert(req: ConversionRequest): Promise<Conversion> {
    const done = this.conversions.get(req.idempotencyKey);
    if (done) return done;
    const rate = await this.fxRate(req.sellCurrency, req.buyCurrency);
    const src = wallet(req.accountId, req.sellCurrency);
    if ((this.balances.get(src) ?? 0) < req.sellAmount) throw new Error(`insufficient ${req.sellCurrency} to convert`);
    const c: Conversion = { id: `conv_${++this.seq}`, sellAmount: req.sellAmount, buyAmount: Math.floor(req.sellAmount * rate), rate };
    this.balances.set(src, (this.balances.get(src) ?? 0) - c.sellAmount);
    this.fund(req.accountId, req.buyCurrency, c.buyAmount);
    this.conversions.set(req.idempotencyKey, c);
    return c;
  }

  async balanceSnapshot(): Promise<BalanceSnapshot> {
    return {
      reportId: `mock_report_${++this.seq}`,
      rows: [...this.balances].map(([k, v]) => {
        const [accountId, currency] = k.split("|") as [string, string];
        return { accountId, currency, available: v, total: v };
      }),
    };
  }
}
