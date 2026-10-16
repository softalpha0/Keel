// All money is integer minor units (cents) to avoid floating-point drift.
export type Cents = number;

export const usd = (dollars: number): Cents => Math.round(dollars * 100);

export const fmt = (c: Cents): string =>
  (c < 0 ? "-$" : "$") +
  (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** Basis-point share of an amount, rounded down so we never over-collect. */
export const bps = (amount: Cents, basisPoints: number): Cents =>
  Math.floor((amount * basisPoints) / 10_000);

export type Tier = "healthy" | "watch" | "stressed";

export interface Borrower {
  id: string;
  name: string;
  /** Airwallex connected account that receives advances and revenue. */
  accountId: string;
  /** Share of weekly revenue collected as repayment, in basis points. */
  holdbackBps: number;
}

export interface Advance {
  id: string;
  borrowerId: string;
  principal: Cents;
  fee: Cents;
  /** principal + fee still to collect */
  outstanding: Cents;
  disbursedWeek: number;
}

/** Capital promised to a borrower but not yet disbursed. Counts against free capital. */
export interface Commitment {
  id: string;
  borrowerId: string;
  amount: Cents;
  week: number;
  reason: string;
}

export interface AdvanceRequest {
  id: string;
  borrowerId: string;
  amount: Cents;
  week: number;
}

export interface HealthSignals {
  avgWeeklyRevenue: Cents;
  trendPct: number;
  volatility: number;
  lastWeekChangePct: number;
  weeksObserved: number;
  tier: Tier;
  reasons: string[];
}

export type OptionKind = "full" | "partial" | "delay" | "reallocate" | "decline";

export interface Reallocation {
  commitmentId: string;
  fromBorrowerId: string;
  reduceBy: Cents;
}

export interface AdvanceOption {
  kind: OptionKind;
  amount: Cents;
  executeWeek: number;
  reallocations: Reallocation[];
  /** Platform balance after this option and all remaining commitments settle. */
  projectedBalanceAfter: Cents;
  breachesFloor: boolean;
  feasible: boolean;
  expectedFee: Cents;
  expectedLoss: Cents;
  /** Cost of delaying or of taking capital from another borrower. */
  frictionCost: Cents;
  /** expectedFee - expectedLoss - frictionCost. Higher is better. */
  score: Cents;
  rationale: string[];
}
