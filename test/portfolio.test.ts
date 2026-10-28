import { describe, expect, it } from "vitest";
import { parseBalanceCsv } from "../src/bank/airwallex.js";
import type { BankAdapter } from "../src/bank/types.js";
import { reconcilePortfolio } from "../src/reconcile/portfolio.js";
import { runScenario, PLATFORM } from "../src/sim/run.js";
import { demoScenario } from "../src/sim/scenario.js";

describe("whole-portfolio reconciliation", () => {
  it("matches every wallet three ways after the demo run, including Kopi's SGD wallet", async () => {
    const s = demoScenario();
    const run = await runScenario(s);
    const check = await reconcilePortfolio({ bank: run.bank, ledger: run.ledger, borrowers: s.borrowers, staged: run.staged, openingWallets: run.openingWallets, platformAccountId: PLATFORM });
    expect(check.allMatch).toBe(true);
    expect(check.rows.map((r) => `${r.label} ${r.currency}`)).toEqual(["Platform USD", "Kopi Roasters SGD", "Kopi Roasters USD", "Nimbus Apparel USD", "Ledgerly SaaS USD"]);
    expect(check.rows.every((r) => r.report !== undefined)).toBe(true);
  });

  it("flags a wallet when the ledger and the bank disagree", async () => {
    const s = demoScenario();
    const run = await runScenario(s);
    run.ledger.receipts.find((r) => r.borrowerId === "nimbus" && r.kind === "collect")!.amount += 100;
    const check = await reconcilePortfolio({ bank: run.bank, ledger: run.ledger, borrowers: s.borrowers, staged: run.staged, openingWallets: run.openingWallets, platformAccountId: PLATFORM });
    expect(check.allMatch).toBe(false);
    expect(check.rows.filter((r) => !r.match).map((r) => r.label)).toEqual(["Platform", "Nimbus Apparel"]);
  });

  it("parses Airwallex's BALANCE_REPORT CSV", () => {
    const csv = '﻿account_id,currency,available_balance,reserved_balance,total_balance,last_update\r\n"acct_a",USD,1234.56,0,1234.56,2026-10-28T00:00:00Z\r\nacct_a,SGD,10,5,15,2026-10-28T00:00:00Z\r\n';
    expect(parseBalanceCsv(csv)).toEqual([
      { accountId: "acct_a", currency: "USD", available: 123_456, total: 123_456, lastUpdate: "2026-10-28T00:00:00Z" },
      { accountId: "acct_a", currency: "SGD", available: 1_000, total: 1_500, lastUpdate: "2026-10-28T00:00:00Z" },
    ]);
  });

  it("checks a lagging bank report against the ledger at the time it reflects, and calls a stale one stale", async () => {
    const s = demoScenario();
    const startedAt = new Date();
    const run = await runScenario(s);
    const opening = run.openingWallets;
    // A bank whose report is a snapshot from before the run (like Airwallex's, built from delayed data).
    const lagging = (lastUpdate?: string, nudge = 0): BankAdapter => ({
      ...run.bank,
      getBalance: run.bank.getBalance.bind(run.bank),
      balanceSnapshot: async () => ({
        reportId: "rpt_lag",
        rows: [...opening].map(([k, v]) => {
          const [accountId, currency] = k.split("|") as [string, string];
          return { accountId, currency, available: v + nudge, total: v + nudge, ...(lastUpdate && { lastUpdate }) };
        }),
      }),
    });
    const args = { ledger: run.ledger, borrowers: s.borrowers, staged: run.staged, openingWallets: run.openingWallets, platformAccountId: PLATFORM, runStartedAt: startedAt };

    const asOfStart = await reconcilePortfolio({ ...args, bank: lagging() });
    expect(asOfStart.allMatch).toBe(true);
    expect(asOfStart.reportLags).toBe(true);
    expect(asOfStart.rows.filter((r) => r.label !== "Platform").every((r) => r.reportAsOf === 0)).toBe(true);

    // Off by one cent from every point in history, and updated after the run began: a real mismatch.
    const wrong = await reconcilePortfolio({ ...args, bank: lagging(new Date(Date.now() + 60_000).toISOString(), 1) });
    expect(wrong.allMatch).toBe(false);

    // Same values but last updated before the run began: stale, not wrong.
    const stale = await reconcilePortfolio({ ...args, bank: lagging("2026-10-27T05:25:40+0000", 1) });
    expect(stale.allMatch).toBe(true);
    expect(stale.rows.filter((r) => r.label !== "Platform").every((r) => r.reportStale)).toBe(true);
  });
});
