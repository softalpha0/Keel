import type { Advance, Borrower, Cents } from "../domain.js";
import type { WeekReport } from "../agent/lending-agent.js";
import type { DecisionRecord, Ledger, Receipt } from "../ledger.js";
import type { PortfolioCheck } from "../reconcile/portfolio.js";

/**
 * A finished run, saved for the website's Sandbox run page.
 * Written by `npm run demo:sandbox` so judges can see the real Airwallex object ids
 * behind every decision. Plain JSON: no secrets, only ids and amounts.
 */
export interface RunRecord {
  version: 1;
  source: "airwallex-sandbox" | "simulated";
  runId: string;
  startedAt: string;
  finishedAt: string;
  currency: string;
  fund: { size: Cents; reserveFloor: Cents; openingBalance: Cents };
  borrowers: Pick<Borrower, "id" | "name" | "accountId" | "currency">[];
  weeks: WeekReport[];
  movements: (Receipt & { requestId?: string })[];
  receivables: Ledger["receivables"];
  decisions: DecisionRecord[];
  advances: Advance[];
  events: Ledger["events"];
  floorHeldEveryWeek: boolean;
  reconciledEveryWeek: boolean;
  /** Airwallex BALANCE_REPORT requested at the end of a sandbox run: the bank's own portfolio snapshot. */
  balanceReport?: BalanceReportRef;
  /** Every wallet checked three ways at the end of the run. */
  portfolio?: PortfolioCheck;
  /** How human approvals were collected: auto (demo), terminal or slack. */
  approvals?: string;
  /** Signed Airwallex webhook deliveries during the run. */
  webhooks?: { accepted: number; rejected: number; duplicates: number };
}

export interface BalanceReportRef {
  requestedAt: string;
  id?: string;
  status?: string;
  error?: string;
}

export function buildRunRecord(args: {
  source: RunRecord["source"];
  runId: string;
  startedAt: Date;
  fundSize: Cents;
  reserveFloor: Cents;
  borrowers: Borrower[];
  ledger: Ledger;
  reports: WeekReport[];
  requestIdFor?: (idempotencyKey: string) => string;
  balanceReport?: BalanceReportRef;
  portfolio?: PortfolioCheck;
  approvals?: string;
  webhooks?: RunRecord["webhooks"];
}): RunRecord {
  const { ledger, reports } = args;
  return {
    version: 1,
    source: args.source,
    runId: args.runId,
    startedAt: args.startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    currency: "USD",
    fund: { size: args.fundSize, reserveFloor: args.reserveFloor, openingBalance: ledger.openingPlatformBalance },
    borrowers: args.borrowers.map(({ id, name, accountId, currency }) => ({ id, name, accountId, ...(currency && { currency }) })),
    weeks: reports,
    movements: ledger.receipts.map((r) => ({ ...r, requestId: args.requestIdFor?.(r.idempotencyKey) })),
    receivables: ledger.receivables,
    decisions: ledger.decisions,
    advances: ledger.advances,
    events: ledger.events,
    floorHeldEveryWeek: reports.every((r) => r.floorHeld),
    reconciledEveryWeek: reports.every((r) => r.reconciled),
    ...(args.balanceReport && { balanceReport: args.balanceReport }),
    ...(args.portfolio && { portfolio: args.portfolio }),
    ...(args.approvals && { approvals: args.approvals }),
    ...(args.webhooks && { webhooks: args.webhooks }),
  };
}
