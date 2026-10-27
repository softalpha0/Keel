import type { Advance, AdvanceOption, Cents, Commitment, HealthSignals } from "./domain.js";
import type { Transfer } from "./bank/types.js";

export type MovementKind = "disburse" | "collect";

export interface Receipt {
  kind: MovementKind;
  idempotencyKey: string;
  borrowerId: string;
  amount: Cents;
  transferId: string;
  status: Transfer["status"];
  attempts: number;
  week: number;
}

export interface Receivable {
  id: string;
  week: number;
  advanceId: string;
  borrowerId: string;
  amount: Cents;
  /** wallet-short: the borrower wallet could not cover the charge. late-payment: customer money had not settled yet. */
  reason: "wallet-short" | "late-payment";
  collected: Cents;
  settledWeek?: number;
}

export interface DecisionRecord {
  week: number;
  type: "advance-request" | "health-review" | "commitment";
  borrowerId: string;
  inputs: Record<string, unknown>;
  options?: AdvanceOption[];
  chosen?: AdvanceOption["kind"];
  decidedBy: "rules" | "claude";
  approval?: { required: boolean; approved: boolean; by: string };
  memo: string;
  receipts: string[];
}

/** The loan book plus an append-only decision log. The source of truth for reconciliation. */
export class Ledger {
  advances: Advance[] = [];
  commitments: Commitment[] = [];
  receipts: Receipt[] = [];
  decisions: DecisionRecord[] = [];
  events: { week: number; level: "info" | "warn"; text: string }[] = [];
  /** Repayments that were due but not collected yet: a short wallet, or customer payments that arrive late. */
  receivables: Receivable[] = [];
  revenue = new Map<string, Cents[]>();
  signals = new Map<string, HealthSignals>();
  private seq = 0;

  constructor(readonly openingPlatformBalance: Cents) {}

  nextId(prefix: string) {
    return `${prefix}_${++this.seq}`;
  }

  receiptFor(key: string) {
    return this.receipts.find((r) => r.idempotencyKey === key && r.status === "settled");
  }

  outstanding(borrowerId: string): Cents {
    return this.advances.filter((a) => a.borrowerId === borrowerId).reduce((s, a) => s + a.outstanding, 0);
  }

  exposure(borrowerId: string): Cents {
    const owedPrincipal = this.advances
      .filter((a) => a.borrowerId === borrowerId)
      .reduce((s, a) => s + Math.round((a.outstanding * a.principal) / (a.principal + a.fee)), 0);
    const pending = this.commitments.filter((c) => c.borrowerId === borrowerId).reduce((s, c) => s + c.amount, 0);
    return owedPrincipal + pending;
  }

  /** What the platform balance should be if every settled movement is accounted for. */
  expectedPlatformBalance(): Cents {
    let bal = this.openingPlatformBalance;
    for (const r of this.receipts) {
      if (r.status !== "settled") continue;
      bal += r.kind === "collect" ? r.amount : -r.amount;
    }
    return bal;
  }

  openReceivables(borrowerId?: string): Receivable[] {
    return this.receivables.filter((r) => r.settledWeek === undefined && (!borrowerId || r.borrowerId === borrowerId));
  }

  log(week: number, text: string, level: "info" | "warn" = "info") {
    this.events.push({ week, level, text });
  }
}
