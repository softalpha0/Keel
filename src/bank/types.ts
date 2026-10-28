import type { Cents } from "../domain.js";

export interface TransferRequest {
  fromAccountId: string;
  toAccountId: string;
  amount: Cents;
  /** Same key => same transfer. Retries must reuse it. */
  idempotencyKey: string;
  reference: string;
  /** Defaults to the platform currency. */
  currency?: string;
}

export type TransferStatus = "pending" | "settled" | "failed";

export interface Transfer {
  id: string;
  status: TransferStatus;
  amount: Cents;
  idempotencyKey: string;
  /** How the final status was learned: a signed webhook, or reading it back. */
  confirmedBy?: "webhook" | "poll";
}

export interface ConversionRequest {
  accountId: string;
  sellCurrency: string;
  buyCurrency: string;
  sellAmount: Cents;
  idempotencyKey: string;
}

export interface Conversion {
  id: string;
  sellAmount: Cents;
  buyAmount: Cents;
  /** Units of buy currency per unit of sell currency. */
  rate: number;
}

/** One wallet line from the bank's own balance report. */
export interface BalanceRow {
  accountId: string;
  currency: string;
  available: Cents;
  total: Cents;
}

export interface BalanceSnapshot {
  /** Bank-side id of the report, if the bank produced one. */
  reportId?: string;
  rows: BalanceRow[];
}

/**
 * Everything the agent needs from a bank. MockBank implements it in memory;
 * AirwallexBank implements it against the sandbox.
 */
export interface BankAdapter {
  readonly name: string;
  getBalance(accountId: string, currency?: string): Promise<Cents>;
  transfer(req: TransferRequest): Promise<Transfer>;
  getTransfer(id: string): Promise<Transfer>;
  /** Sandbox only: simulate customer revenue landing in a borrower's account. */
  stageRevenue(accountId: string, amount: Cents, idempotencyKey: string, currency?: string): Promise<void>;
  /** Indicative rate: units of `buy` per unit of `sell`. */
  fxRate?(sell: string, buy: string): Promise<number>;
  /** Convert money already in `accountId` from one currency to another. Idempotent by key. */
  convert?(req: ConversionRequest): Promise<Conversion>;
  /** The bank's own snapshot of every wallet, for reconciling the whole portfolio. */
  balanceSnapshot?(): Promise<BalanceSnapshot>;
}
