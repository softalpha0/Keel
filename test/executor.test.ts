import { describe, expect, it } from "vitest";
import { MockBank } from "../src/bank/mock.js";
import { Executor } from "../src/executor.js";
import { Ledger } from "../src/ledger.js";
import { defaultPolicy, FloorBreachError } from "../src/policy/engine.js";

const cfg = defaultPolicy(10_000_000, 3_000_000);

const setup = () => {
  const bank = new MockBank({ platform: 10_000_000, acct_a: 500_000 });
  const ledger = new Ledger(10_000_000);
  return { bank, ledger, ex: new Executor(bank, ledger, cfg, "platform") };
};

const collect = { kind: "collect" as const, borrowerId: "a", borrowerAccountId: "acct_a", amount: 100_000, idempotencyKey: "collect:adv_1:w6", reference: "t", week: 6 };

describe("Executor", () => {
  it("retries a lost response with the same key and moves money exactly once", async () => {
    const { bank, ledger, ex } = setup();
    bank.injectLostResponse(() => true);
    const r = await ex.move(collect);
    expect(r.status).toBe("settled");
    expect(r.attempts).toBe(2);
    expect(bank.appliedTransfers).toBe(1);
    expect(await bank.getBalance("acct_a")).toBe(400_000);
    expect(await bank.getBalance("platform")).toBe(ledger.expectedPlatformBalance());
  });

  it("replaying the same intent is a no-op", async () => {
    const { bank, ex } = setup();
    await ex.move(collect);
    await ex.move(collect);
    expect(bank.appliedTransfers).toBe(1);
  });

  it("refuses a disbursement that would breach the reserve floor, before calling the bank", async () => {
    const { bank, ex } = setup();
    await expect(
      ex.move({ kind: "disburse", borrowerId: "a", borrowerAccountId: "acct_a", amount: 7_000_001, idempotencyKey: "disburse:x", reference: "t", week: 1 }),
    ).rejects.toBeInstanceOf(FloorBreachError);
    expect(bank.appliedTransfers).toBe(0);
  });
});
