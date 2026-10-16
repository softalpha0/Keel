import type { Cents } from "./domain.js";
import type { BankAdapter } from "./bank/types.js";
import { assertFloor, type PolicyConfig } from "./policy/engine.js";
import type { Ledger, MovementKind, Receipt } from "./ledger.js";

export interface MoveIntent {
  kind: MovementKind;
  borrowerId: string;
  borrowerAccountId: string;
  amount: Cents;
  /** Deterministic, e.g. `collect:adv_1:w6`. Same intent => same key, forever. */
  idempotencyKey: string;
  reference: string;
  week: number;
}

/**
 * The only component allowed to move money.
 * - checks the reserve floor against the live balance before any outflow
 * - retries with the same idempotency key, so a lost response can never pay twice
 * - records "settled" only after reading the transfer back from the bank
 */
export class Executor {
  constructor(
    private bank: BankAdapter,
    private ledger: Ledger,
    private cfg: PolicyConfig,
    private platformAccountId: string,
    private maxAttempts = 3,
  ) {}

  async move(intent: MoveIntent): Promise<Receipt> {
    const done = this.ledger.receiptFor(intent.idempotencyKey);
    if (done) return done;

    const outflow = intent.kind === "disburse";
    const from = outflow ? this.platformAccountId : intent.borrowerAccountId;
    const to = outflow ? intent.borrowerAccountId : this.platformAccountId;

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
        };
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
