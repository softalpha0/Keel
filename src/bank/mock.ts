import type { Cents } from "../domain.js";
import type { BankAdapter, Transfer, TransferRequest } from "./types.js";

/**
 * In-memory bank with real idempotency semantics and fault injection,
 * so the demo can show a lost response being retried without double-moving money.
 */
export class MockBank implements BankAdapter {
  readonly name = "mock";
  private balances = new Map<string, Cents>();
  private transfers = new Map<string, Transfer>();
  private byKey = new Map<string, Transfer>();
  private stagedKeys = new Set<string>();
  private faults: { match: (r: TransferRequest) => boolean; mode: "lost-response" | "reject" }[] = [];
  private seq = 0;
  /** Count of transfer calls that actually moved money. Tests use it to prove no double-pay. */
  appliedTransfers = 0;

  constructor(initial: Record<string, Cents> = {}) {
    for (const [id, bal] of Object.entries(initial)) this.balances.set(id, bal);
  }

  /** Next matching transfer settles but the caller sees a network error (the classic double-pay trap). */
  injectLostResponse(match: (r: TransferRequest) => boolean) {
    this.faults.push({ match, mode: "lost-response" });
  }

  injectReject(match: (r: TransferRequest) => boolean) {
    this.faults.push({ match, mode: "reject" });
  }

  async getBalance(accountId: string): Promise<Cents> {
    return this.balances.get(accountId) ?? 0;
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

    const from = this.balances.get(req.fromAccountId) ?? 0;
    const t: Transfer = { id: `tr_${++this.seq}`, status: "settled", amount: req.amount, idempotencyKey: req.idempotencyKey };
    if (from < req.amount) {
      t.status = "failed";
    } else {
      this.balances.set(req.fromAccountId, from - req.amount);
      this.balances.set(req.toAccountId, (this.balances.get(req.toAccountId) ?? 0) + req.amount);
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

  async stageRevenue(accountId: string, amount: Cents, idempotencyKey: string): Promise<void> {
    if (this.stagedKeys.has(idempotencyKey)) return;
    this.stagedKeys.add(idempotencyKey);
    this.balances.set(accountId, (this.balances.get(accountId) ?? 0) + amount);
  }
}
