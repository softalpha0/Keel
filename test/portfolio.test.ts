import { describe, expect, it } from "vitest";
import { parseBalanceCsv } from "../src/bank/airwallex.js";
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
      { accountId: "acct_a", currency: "USD", available: 123_456, total: 123_456 },
      { accountId: "acct_a", currency: "SGD", available: 1_000, total: 1_500 },
    ]);
  });
});
