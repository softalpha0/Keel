import type { Cents } from "../domain.js";

export interface TransferRequest {
  fromAccountId: string;
  toAccountId: string;
  amount: Cents;
  /** Same key => same transfer. Retries must reuse it. */
  idempotencyKey: string;
  reference: string;
}

export type TransferStatus = "pending" | "settled" | "failed";

export interface Transfer {
  id: string;
  status: TransferStatus;
  amount: Cents;
  idempotencyKey: string;
}

/**
 * Everything the agent needs from a bank. MockBank implements it in memory;
 * AirwallexBank implements it against the sandbox.
 */
export interface BankAdapter {
  readonly name: string;
  getBalance(accountId: string): Promise<Cents>;
  transfer(req: TransferRequest): Promise<Transfer>;
  getTransfer(id: string): Promise<Transfer>;
  /** Sandbox only: simulate customer revenue landing in a borrower's account. */
  stageRevenue(accountId: string, amount: Cents, idempotencyKey: string): Promise<void>;
}
