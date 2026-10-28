import { PLATFORM_CURRENCY, type Borrower, type Cents } from "../domain.js";
import type { BalanceSnapshot, BankAdapter } from "../bank/types.js";
import type { Ledger } from "../ledger.js";
import type { StagedRevenue } from "../sim/run.js";

export interface WalletCheck {
  label: string;
  accountId: string;
  currency: string;
  /** What Keel's own records say the wallet should hold now. */
  expected: Cents;
  /** The balance API, read now. */
  live: Cents;
  /** The bank's BALANCE_REPORT row (available balance), if the report has one. */
  report?: Cents;
  /**
   * Which point in Keel's history the report line agrees with: "now", a week number,
   * 0 for "before this run", or undefined when it agrees with none (a real mismatch).
   */
  reportAsOf?: "now" | number;
  reportLastUpdate?: string;
  /** The bank's line was last updated before this run began: it cannot speak for this run either way. */
  reportStale?: boolean;
  match: boolean;
}

export interface PortfolioCheck {
  at: string;
  reportId?: string;
  reportError?: string;
  /** True when the bank's report is a snapshot from earlier in (or before) the run, rather than now. */
  reportLags?: boolean;
  rows: WalletCheck[];
  allMatch: boolean;
}

/**
 * End-of-run reconciliation of the whole portfolio, not just the platform:
 * every wallet Keel touched, checked three ways (Keel's ledger, the live balance API, the bank's own report).
 *
 * Borrower wallet = opening + customer revenue staged + advances received - repayments charged.
 * The ledger and the live balance must agree now. The bank's report is generated from data that can lag
 * the live balance, so it must agree with the ledger at *some* point Keel can name (now, or the end of a
 * given week, or before the run); a value that matches no point in the ledger's history is a mismatch.
 */
export async function reconcilePortfolio(args: {
  bank: BankAdapter;
  ledger: Ledger;
  borrowers: Borrower[];
  staged: StagedRevenue[];
  openingWallets: Map<string, Cents>;
  platformAccountId: string;
  /** When the run began; a report line last updated before this is stale, not wrong. */
  runStartedAt?: Date;
}): Promise<PortfolioCheck> {
  const { bank, ledger } = args;
  const acct = new Map(args.borrowers.map((b) => [b.id, b]));

  // Every flow into or out of each wallet, by week.
  const flows = new Map<string, { week: number; amount: Cents }[]>();
  const flow = (key: string, week: number, amount: Cents) => flows.set(key, [...(flows.get(key) ?? []), { week, amount }]);
  for (const key of args.openingWallets.keys()) flows.set(key, []);
  for (const s of args.staged) flow(`${acct.get(s.borrowerId)!.accountId}|${s.currency}`, s.week, s.amount);
  for (const r of ledger.receipts) {
    if (r.status !== "settled") continue;
    const b = acct.get(r.borrowerId)!;
    if (r.kind === "disburse") flow(`${b.accountId}|${PLATFORM_CURRENCY}`, r.week, r.amount);
    else flow(`${b.accountId}|${r.fx?.currency ?? PLATFORM_CURRENCY}`, r.week, -(r.fx?.localAmount ?? r.amount));
  }
  const lastWeek = Math.max(0, ...[...flows.values()].flat().map((f) => f.week));
  /** Balance at the end of each week 0..lastWeek (week 0 = before the run). */
  const history = (opening: Cents, items: { week: number; amount: Cents }[]) =>
    Array.from({ length: lastWeek + 1 }, (_, w) => opening + items.filter((f) => f.week <= w).reduce((s, f) => s + f.amount, 0));

  let snapshot: BalanceSnapshot | undefined;
  let reportError: string | undefined;
  if (bank.balanceSnapshot) {
    try {
      snapshot = await bank.balanceSnapshot();
    } catch (err) {
      reportError = err instanceof Error ? err.message.slice(0, 300) : String(err);
    }
  }
  const lineFor = (accountId: string, currency: string) => snapshot?.rows.find((r) => r.accountId === accountId && r.currency === currency);

  /** Which point in the wallet's history a report value agrees with. */
  const asOf = (report: Cents | undefined, past: Cents[], now: Cents): WalletCheck["reportAsOf"] => {
    if (report === undefined) return undefined;
    if (report === now) return "now";
    // Earliest point that agrees: a wallet unchanged for weeks is described "before this run", not "end of week 2".
    for (let w = 0; w < past.length; w++) if (past[w] === report) return w;
    return undefined;
  };

  const stale = (lastUpdate?: string) => {
    const t = lastUpdate ? Date.parse(lastUpdate.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) : NaN;
    return !!args.runStartedAt && Number.isFinite(t) && t < args.runStartedAt.getTime();
  };

  const rows: WalletCheck[] = [];

  const platformExpected = ledger.expectedPlatformBalance();
  const platformLive = await bank.getBalance(args.platformAccountId);
  // On Airwallex the report lists the platform under its real account id, which Keel does not need to know;
  // when the line is not found the live balance API covers the platform on its own.
  const platformLine = lineFor(args.platformAccountId, PLATFORM_CURRENCY);
  const platformPast = Array.from({ length: lastWeek + 1 }, (_, w) =>
    ledger.receipts.filter((r) => r.status === "settled" && r.week <= w).reduce((s, r) => s + (r.kind === "collect" ? r.amount : -r.amount), ledger.openingPlatformBalance),
  );
  const platformAsOf = asOf(platformLine?.available, platformPast, platformExpected);
  rows.push({
    label: "Platform",
    accountId: args.platformAccountId,
    currency: PLATFORM_CURRENCY,
    expected: platformExpected,
    live: platformLive,
    report: platformLine?.available,
    reportAsOf: platformAsOf,
    reportLastUpdate: platformLine?.lastUpdate,
    reportStale: platformAsOf === undefined && stale(platformLine?.lastUpdate),
    match: platformExpected === platformLive && (platformLine === undefined || platformAsOf !== undefined || stale(platformLine?.lastUpdate)),
  });

  for (const [key, items] of flows) {
    const [accountId, currency] = key.split("|") as [string, string];
    const b = args.borrowers.find((x) => x.accountId === accountId)!;
    const past = history(args.openingWallets.get(key) ?? 0, items);
    const expected = past.at(-1)!;
    const live = await bank.getBalance(accountId, currency);
    const line = lineFor(accountId, currency);
    const report = snapshot ? (line?.available ?? 0) : undefined;
    const reportAsOf = asOf(report, past, expected);
    rows.push({
      label: b.name,
      accountId,
      currency,
      expected,
      live,
      report,
      reportAsOf,
      reportLastUpdate: line?.lastUpdate,
      reportStale: reportAsOf === undefined && stale(line?.lastUpdate),
      match: live === expected && (report === undefined || reportAsOf !== undefined || stale(line?.lastUpdate)),
    });
  }
  return {
    at: new Date().toISOString(),
    reportId: snapshot?.reportId,
    reportError,
    reportLags: rows.some((r) => r.reportStale || (typeof r.reportAsOf === "number" && r.report !== r.expected)),
    rows,
    allMatch: rows.every((r) => r.match),
  };
}

/** "now" -> "now"; 0 -> "before this run"; 6 -> "end of week 6". */
export const describeAsOf = (a: WalletCheck["reportAsOf"]) => (a === "now" ? "now" : a === 0 ? "before this run" : a === undefined ? "no point in the ledger" : `end of week ${a}`);
