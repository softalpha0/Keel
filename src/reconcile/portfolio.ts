import { PLATFORM_CURRENCY, type Borrower, type Cents } from "../domain.js";
import type { BalanceSnapshot, BankAdapter } from "../bank/types.js";
import type { Ledger } from "../ledger.js";
import type { StagedRevenue } from "../sim/run.js";

export interface WalletCheck {
  label: string;
  accountId: string;
  currency: string;
  /** What Keel's own records say the wallet should hold. */
  expected: Cents;
  /** The balance API, read now. */
  live: Cents;
  /** The bank's BALANCE_REPORT row (available balance), if the report was produced. */
  report?: Cents;
  match: boolean;
}

export interface PortfolioCheck {
  at: string;
  reportId?: string;
  reportError?: string;
  rows: WalletCheck[];
  allMatch: boolean;
}

/**
 * End-of-run reconciliation of the whole portfolio, not just the platform:
 * every wallet Keel touched, checked three ways (Keel's ledger, the live balance API, the bank's own report).
 *
 * Borrower wallet expectation = opening + customer revenue staged + advances received - repayments charged.
 */
export async function reconcilePortfolio(args: {
  bank: BankAdapter;
  ledger: Ledger;
  borrowers: Borrower[];
  staged: StagedRevenue[];
  openingWallets: Map<string, Cents>;
  platformAccountId: string;
}): Promise<PortfolioCheck> {
  const { bank, ledger } = args;
  const expected = new Map(args.openingWallets);
  const add = (key: string, v: Cents) => expected.set(key, (expected.get(key) ?? 0) + v);
  const acct = new Map(args.borrowers.map((b) => [b.id, b]));

  for (const s of args.staged) add(`${acct.get(s.borrowerId)!.accountId}|${s.currency}`, s.amount);
  for (const r of ledger.receipts) {
    if (r.status !== "settled") continue;
    const b = acct.get(r.borrowerId)!;
    if (r.kind === "disburse") add(`${b.accountId}|${PLATFORM_CURRENCY}`, r.amount);
    else add(`${b.accountId}|${r.fx?.currency ?? PLATFORM_CURRENCY}`, -(r.fx?.localAmount ?? r.amount));
  }

  let snapshot: BalanceSnapshot | undefined;
  let reportError: string | undefined;
  if (bank.balanceSnapshot) {
    try {
      snapshot = await bank.balanceSnapshot();
    } catch (err) {
      reportError = err instanceof Error ? err.message.slice(0, 300) : String(err);
    }
  }
  const fromReport = (accountId: string, currency: string) => snapshot?.rows.find((r) => r.accountId === accountId && r.currency === currency)?.available;

  const rows: WalletCheck[] = [];
  const platformExpected = ledger.expectedPlatformBalance();
  const platformLive = await bank.getBalance(args.platformAccountId);
  // On Airwallex the report lists the platform under its real account id, which Keel does not need to know;
  // when the row is not found the live balance API covers the platform on its own.
  const platformReport = fromReport(args.platformAccountId, PLATFORM_CURRENCY);
  rows.push({
    label: "Platform",
    accountId: args.platformAccountId,
    currency: PLATFORM_CURRENCY,
    expected: platformExpected,
    live: platformLive,
    report: platformReport,
    match: platformExpected === platformLive && (platformReport === undefined || platformReport === platformExpected),
  });

  for (const [key, exp] of expected) {
    const [accountId, currency] = key.split("|") as [string, string];
    const b = args.borrowers.find((x) => x.accountId === accountId)!;
    const live = await bank.getBalance(accountId, currency);
    const report = snapshot ? (fromReport(accountId, currency) ?? 0) : undefined;
    rows.push({ label: b.name, accountId, currency, expected: exp, live, report, match: live === exp && (report === undefined || report === exp) });
  }
  return { at: new Date().toISOString(), reportId: snapshot?.reportId, reportError, rows, allMatch: rows.every((r) => r.match) };
}
