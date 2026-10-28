import { describe, expect, it } from "vitest";
import { MockBank } from "../src/bank/mock.js";
import { Executor } from "../src/executor.js";
import { Ledger } from "../src/ledger.js";
import { defaultPolicy } from "../src/policy/engine.js";
import { runScenario } from "../src/sim/run.js";
import { demoScenario } from "../src/sim/scenario.js";

describe("multi-currency repayments", () => {
  it("charges in the borrower's currency, converts once into USD, and survives a lost response", async () => {
    const bank = new MockBank({ platform: 10_000_000 });
    bank.fund("acct_k", "SGD", 500_000);
    bank.setRate("SGD", "USD", 0.74);
    bank.injectLostResponse(() => true);
    const ledger = new Ledger(10_000_000);
    const ex = new Executor(bank, ledger, defaultPolicy(10_000_000, 3_000_000), "platform");

    const r = await ex.move({ kind: "collect", borrowerId: "k", borrowerAccountId: "acct_k", amount: 100_000, currency: "SGD", idempotencyKey: "collect:adv_1:w4", reference: "x", week: 4 });

    expect(r.attempts).toBe(2);
    expect(r.fx).toMatchObject({ currency: "SGD", localAmount: 100_000, rate: 0.74 });
    expect(r.amount).toBe(74_000);
    expect(await bank.getBalance("acct_k", "SGD")).toBe(400_000);
    expect(await bank.getBalance("platform", "SGD")).toBe(0);
    expect(await bank.getBalance("platform")).toBe(10_074_000);
    expect(ledger.expectedPlatformBalance()).toBe(10_074_000);
  });

  it("refuses a foreign-currency disbursement (advances go out in USD)", async () => {
    const bank = new MockBank({ platform: 10_000_000 });
    const ex = new Executor(bank, new Ledger(10_000_000), defaultPolicy(10_000_000, 3_000_000), "platform");
    await expect(ex.move({ kind: "disburse", borrowerId: "k", borrowerAccountId: "acct_k", amount: 1, currency: "SGD", idempotencyKey: "d", reference: "x", week: 1 })).rejects.toThrow(/not supported/);
  });

  it("runs Kopi in SGD in the demo, with every repayment converted and nothing left in the platform's SGD wallet", async () => {
    const { ledger, bank, reports } = await runScenario(demoScenario());
    const kopi = ledger.receipts.filter((r) => r.borrowerId === "kopi" && r.kind === "collect");
    expect(kopi.length).toBeGreaterThan(3);
    expect(kopi.every((r) => r.fx?.currency === "SGD" && r.amount < r.fx.localAmount)).toBe(true);
    expect(await bank.getBalance("acct_platform", "SGD")).toBe(0);
    expect(reports.every((r) => r.reconciled && r.floorHeld)).toBe(true);
  });
});
