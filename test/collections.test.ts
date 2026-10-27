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
    expect(ledger.receivables).toEqual([{ id: "rcv_1", week: 2, advanceId: "adv_1", borrowerId: "a", amount: 5_000, reason: "wallet-short", collected: 0 }]);
    expect(bank.appliedTransfers).toBe(1);
  });

  it("takes its share only of money that settled, then catches up when the late payment lands", async () => {
    const { agent, ledger, bank } = setup();
    // Week 2: $1,000 sold but only $400 settled. $40 collected now, $60 owed.
    await bank.stageRevenue("acct_a", 40_000, "w2");
    await agent.runWeek(2, new Map([["a", 100_000]]), [], { received: new Map([["a", 40_000]]), late: [] });
    expect(ledger.advances[0]!.outstanding).toBe(1_080_000 - 4_000);
    expect(ledger.openReceivables()).toMatchObject([{ reason: "late-payment", amount: 6_000, collected: 0 }]);

    // Week 3: the late $600 lands along with $1,000 of new sales.
    await bank.stageRevenue("acct_a", 160_000, "w3");
    await agent.runWeek(3, new Map([["a", 100_000]]), [], { received: new Map([["a", 100_000]]), late: [{ borrowerId: "a", forWeek: 2, amount: 60_000 }] });
    expect(ledger.openReceivables()).toEqual([]);
    expect(ledger.receivables[0]).toMatchObject({ collected: 6_000, settledWeek: 3 });
    expect(ledger.advances[0]!.outstanding).toBe(1_080_000 - 4_000 - 6_000 - 10_000);
    // The late money is not read as a revenue drop: signals see sales, not settlement.
    expect(ledger.revenue.get("a")).toEqual([100_000, 100_000]);
  });

  it("re-checks a pending advance before paying it out", async () => {
    const { agent, ledger, bank } = setup();
    ledger.commitments.push({ id: "cmt_1", borrowerId: "a", amount: 500_000, week: 2, reason: "approved earlier" });
    // Only two weeks of history: the borrower is on watch, and its existing $10,800 balance already uses its capacity.
    await bank.stageRevenue("acct_a", 100_000, "w2");
    await agent.runWeek(2, new Map([["a", 100_000]]), []);
    expect(ledger.commitments).toEqual([]);
    const d = ledger.decisions.find((x) => x.type === "commitment")!;
    expect(d.chosen).toBe("decline");
    expect(ledger.advances).toHaveLength(1);
  });
});

function setup() {
  const bank = new MockBank({ platform: 10_000_000, acct_a: 0 });
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
  return { agent, ledger, bank };
}
