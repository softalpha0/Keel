import { PLATFORM_CURRENCY, type Cents } from "./domain.js";
import type { BankAdapter } from "./bank/types.js";
import { assertFloor, type PolicyConfig } from "./policy/engine.js";
import type { Journal, Ledger, MovementKind, Receipt } from "./ledger.js";

export interface MoveIntent {
  kind: MovementKind;
  borrowerId: string;
  borrowerAccountId: string;
  /** In `currency` (the borrower's for a collection). Disbursements are always in the platform currency. */
  amount: Cents;
  currency?: string;
  /** Deterministic, e.g. `collect:adv_1:w6`. Same intent => same key, forever. */
  idempotencyKey: string;
  reference: string;
  week: number;
}

/**
 * One queue per platform wallet at a bank, shared by every Executor that touches it. A payout's
 * floor check and its transfer then happen as one step: two payouts started at the same moment
 * can't both pass the check against the same balance.
 */
const queues = new WeakMap<BankAdapter, Map<string, Promise<unknown>>>();

function serialize<T>(bank: BankAdapter, account: string, job: () => Promise<T>): Promise<T> {
  const perBank = queues.get(bank) ?? new Map<string, Promise<unknown>>();
  queues.set(bank, perBank);
  const prev = perBank.get(account) ?? Promise.resolve();
  const run = prev.then(job, job);
  perBank.set(
    account,
    run.catch(() => undefined),
  );
  return run;
}

/**
 * The only component allowed to move money.
 * - checks the reserve floor against the live balance before any outflow, one movement at a time
 * - retries with the same idempotency key, so a lost response can never pay twice
 * - the same key requested twice at once shares one movement and books one receipt
 * - records "settled" only after reading the transfer back from the bank
 */
export class Executor {
  /** Movements in progress, by idempotency key. */
  private inflight = new Map<string, Promise<Receipt>>();

  constructor(
    private bank: BankAdapter,
    private ledger: Ledger,
    private cfg: PolicyConfig,
    private platformAccountId: string,
    private maxAttempts = 3,
    /** Durable record of settled movements, checked before any money moves. */
    private journal?: Journal,
  ) {}

  move(intent: MoveIntent): Promise<Receipt> {
    const done = this.ledger.receiptFor(intent.idempotencyKey);
    if (done) return Promise.resolve(done);
    // A second call with a key already moving waits for that movement instead of starting another.
    const running = this.inflight.get(intent.idempotencyKey);
    if (running) return running;
    const p = serialize(this.bank, this.platformAccountId, () => this.execute(intent)).finally(() => this.inflight.delete(intent.idempotencyKey));
    this.inflight.set(intent.idempotencyKey, p);
    return p;
  }

  private async execute(intent: MoveIntent): Promise<Receipt> {
    // Re-check inside the queue: an earlier job may have settled this key while we waited.
    const done = this.ledger.receiptFor(intent.idempotencyKey);
    if (done) return done;
    if (!this.journal) return this.transfer(intent);

    // The journal outlives this process: a movement settled by an earlier run or another process
    // is booked here from its record instead of being sent again.
    const claim = await this.journal.claim(intent.idempotencyKey);
    if (!claim.owned) return this.adopt(claim.receipt, intent);
    try {
      return await this.transfer(intent);
    } finally {
      this.journal.release(intent.idempotencyKey);
    }
  }

  private adopt(receipt: Receipt, intent: MoveIntent): Receipt {
    const booked = this.ledger.receiptFor(intent.idempotencyKey);
    if (booked) return booked;
    this.ledger.receipts.push(receipt);
    this.ledger.log(intent.week, `${intent.idempotencyKey} was already settled (${receipt.transferId}) according to the journal; booked it without moving money again.`);
    return receipt;
  }

  private async transfer(intent: MoveIntent): Promise<Receipt> {
    const outflow = intent.kind === "disburse";
    const from = outflow ? this.platformAccountId : intent.borrowerAccountId;
    const to = outflow ? intent.borrowerAccountId : this.platformAccountId;

    const foreign = !!intent.currency && intent.currency !== PLATFORM_CURRENCY;
    if (foreign && (outflow || !this.bank.convert)) throw new Error(`${intent.kind} in ${intent.currency} is not supported by ${this.bank.name}`);
    if (outflow) assertFloor((await this.bank.getBalance(this.platformAccountId)) - intent.amount, this.cfg);

    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const t = await this.bank.transfer({
          fromAccountId: from,
          toAccountId: to,
          amount: intent.amount,
          idempotencyKey: intent.idempotencyKey,
          reference: intent.reference,
          currency: foreign ? intent.currency : undefined,
        });
        const confirmed = await this.bank.getTransfer(t.id);
        const receipt: Receipt = {
          kind: intent.kind,
          idempotencyKey: intent.idempotencyKey,
          borrowerId: intent.borrowerId,
          amount: intent.amount,
          transferId: confirmed.id,
          status: confirmed.status,
          attempts: attempt,
          week: intent.week,
          confirmedBy: t.confirmedBy ?? confirmed.confirmedBy,
        };
        if (foreign && confirmed.status === "settled") {
          // The repayment landed in the platform's foreign wallet: convert it so the book stays in one currency.
          // Its own idempotency key, so a retry after a lost response converts once.
          const c = await this.bank.convert!({
            accountId: this.platformAccountId,
            sellCurrency: intent.currency!,
            buyCurrency: PLATFORM_CURRENCY,
            sellAmount: intent.amount,
            idempotencyKey: `fx:${intent.idempotencyKey}`,
          });
          receipt.amount = c.buyAmount;
          receipt.fx = { currency: intent.currency!, localAmount: intent.amount, rate: c.rate, conversionId: c.id };
        }
        // Never book the same settled movement twice, whatever path got us here.
        const booked = this.ledger.receiptFor(intent.idempotencyKey);
        if (booked) return booked;
        this.journal?.record(receipt);
        this.ledger.receipts.push(receipt);
        if (attempt > 1) {
          this.ledger.log(
            intent.week,
            `Bank response lost on ${intent.idempotencyKey} (${errText(lastErr)}). Retried with the same key; bank returned original transfer ${confirmed.id}. Moved once, not twice.`,
            "warn",
          );
        }
        return receipt;
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(`${intent.kind} ${intent.idempotencyKey} failed after ${this.maxAttempts} attempts: ${errText(lastErr)}`);
  }
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
