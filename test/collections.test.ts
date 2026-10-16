import { describe, expect, it } from "vitest";
import { RulesAdvisor } from "../src/agent/advisor.js";
import { LendingAgent } from "../src/agent/lending-agent.js";
import { MockBank } from "../src/bank/mock.js";
import { Ledger } from "../src/ledger.js";
import { defaultPolicy } from "../src/policy/engine.js";

describe("collections", () => {
  it("collects only what the wallet holds and records the rest as a receivable", async () => {
    const bank = new MockBank({ platform: 10_000_000, acct_a: 5_000 });
    const ledger = new Ledger(10_000_000);
    ledger.advances.push({ id: "adv_1", borrowerId: "a", principal: 1_000_000, fee: 80_000, outstanding: 1_080_000, disbursedWeek: 1 });
    const agent = new LendingAgent(
      bank,
      ledger,
      defaultPolicy(10_000_000, 3_000_000),
      new Map([["a", { id: "a", name: "A Co", accountId: "acct_a", holdbackBps: 1_000 }]]),
      "platform",
      new RulesAdvisor(),
    );

    // Revenue of $1,000 means $100 is due, but the wallet only holds $50 (revenue was not staged).
    await agent.runWeek(2, new Map([["a", 100_000]]), []);

    expect(await bank.getBalance("acct_a")).toBe(0);
    expect(ledger.advances[0]!.outstanding).toBe(1_080_000 - 5_000);
    expect(ledger.receivables).toEqual([{ week: 2, advanceId: "adv_1", borrowerId: "a", amount: 5_000 }]);
    expect(bank.appliedTransfers).toBe(1);
  });
});
