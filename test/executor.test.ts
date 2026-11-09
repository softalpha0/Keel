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

describe("Executor under concurrency", () => {
  it("two payouts started at once can't both pass the floor check (Cyrus's case: 2 × $40K, $100K balance, $30K floor)", async () => {
    const { bank, ex } = setup();
    const payout = (key: string) => ex.move({ kind: "disburse", borrowerId: "a", borrowerAccountId: "acct_a", amount: 4_000_000, idempotencyKey: key, reference: "t", week: 1 });
    const results = await Promise.allSettled([payout("disburse:p1"), payout("disburse:p2")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")!.reason).toBeInstanceOf(FloorBreachError);
    expect(await bank.getBalance("platform")).toBe(6_000_000);
  });

  it("two payouts on separate executors sharing the bank are still serialised", async () => {
    const { bank, ledger } = setup();
    const a = new Executor(bank, ledger, cfg, "platform");
    const b = new Executor(bank, ledger, cfg, "platform");
    const move = (ex: Executor, key: string) => ex.move({ kind: "disburse", borrowerId: "a", borrowerAccountId: "acct_a", amount: 4_000_000, idempotencyKey: key, reference: "t", week: 1 });
    const results = await Promise.allSettled([move(a, "disburse:q1"), move(b, "disburse:q2")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await bank.getBalance("platform")).toBeGreaterThanOrEqual(cfg.reserveFloor);
  });

  it("two simultaneous collections with the same key move money once and book one receipt", async () => {
    const { bank, ledger, ex } = setup();
    const [r1, r2] = await Promise.all([ex.move(collect), ex.move(collect)]);
    expect(r1).toBe(r2);
    expect(bank.appliedTransfers).toBe(1);
    expect(ledger.receipts.filter((r) => r.idempotencyKey === collect.idempotencyKey)).toHaveLength(1);
    expect(await bank.getBalance("platform")).toBe(ledger.expectedPlatformBalance());
  });
});
