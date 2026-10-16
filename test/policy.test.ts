import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Borrower, Commitment, HealthSignals, Tier } from "../src/domain.js";
import { borrowerCapacity, buildOptions, defaultPolicy, rankOptions, repaymentDue, type DecisionContext } from "../src/policy/engine.js";
import { computeSignals } from "../src/policy/signals.js";

const cfg = defaultPolicy(10_000_000, 3_000_000);

const sig = (tier: Tier, avg = 1_000_000): HealthSignals => ({
  avgWeeklyRevenue: avg,
  trendPct: 0,
  volatility: 0.1,
  lastWeekChangePct: 0,
  weeksObserved: 6,
  tier,
  reasons: [tier],
});

describe("repaymentDue", () => {
  it("never exceeds the holdback share or the amount owed", () => {
    fc.assert(
      fc.property(fc.nat(10_000_000), fc.integer({ min: 0, max: 5_000 }), fc.nat(10_000_000), (rev, hb, owed) => {
        const due = repaymentDue(rev, hb, owed);
        expect(due).toBeGreaterThanOrEqual(0);
        expect(due).toBeLessThanOrEqual(owed);
        expect(due).toBeLessThanOrEqual(Math.floor((rev * hb) / 10_000));
      }),
    );
  });
});

describe("borrowerCapacity", () => {
  it("is zero for a stressed borrower", () => {
    expect(borrowerCapacity(sig("stressed"), 0, cfg)).toBe(0);
  });
  it("is capped by the per-borrower exposure limit", () => {
    expect(borrowerCapacity(sig("healthy", 100_000_000), 0, cfg)).toBe(3_500_000);
  });
});

describe("computeSignals", () => {
  it("flags a sudden revenue drop as stressed", () => {
    const s = computeSignals([1_400_000, 1_400_000, 1_400_000, 1_400_000, 1_400_000, 500_000]);
    expect(s.tier).toBe("stressed");
  });
  it("treats short history as watch", () => {
    expect(computeSignals([1_000_000]).tier).toBe("watch");
  });
});

describe("buildOptions - the reserve floor invariant", () => {
  const tiers = fc.constantFrom<Tier>("healthy", "watch", "stressed");

  it("no feasible option ever projects platform cash below the floor", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 12_000_000 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        tiers,
        tiers,
        fc.array(fc.integer({ min: 1, max: 1_500_000 }), { maxLength: 3 }),
        fc.integer({ min: 0, max: 400_000 }),
        (balance, ask, tier, donorTier, commitAmounts, weekly) => {
          const borrowers = new Map<string, Borrower>([
            ["a", { id: "a", name: "A", accountId: "acct_a", holdbackBps: 1_000 }],
            ["d", { id: "d", name: "D", accountId: "acct_d", holdbackBps: 1_000 }],
          ]);
          const commitments: Commitment[] = commitAmounts.map((amount, i) => ({ id: `c${i}`, borrowerId: "d", amount, week: 9, reason: "t" }));
          const ctx: DecisionContext = {
            week: 5,
            platformBalance: balance,
            commitments,
            borrowers,
            signals: new Map([["a", sig(tier, 1_500_000)], ["d", sig(donorTier)]]),
            exposure: new Map([["a", 0], ["d", commitAmounts.reduce((s, x) => s + x, 0)]]),
            projectedWeeklyCollections: weekly,
          };
          const options = buildOptions({ id: "r", borrowerId: "a", amount: ask, week: 5 }, ctx, cfg);
          const ranked = rankOptions(options);
          expect(ranked.length).toBeGreaterThan(0); // decline is always available
          for (const o of ranked) {
            if (o.kind === "decline") continue;
            expect(o.projectedBalanceAfter).toBeGreaterThanOrEqual(cfg.reserveFloor);
            expect(o.amount).toBeGreaterThanOrEqual(cfg.minAdvance);
            expect(o.amount).toBeLessThanOrEqual(ask);
          }
        },
      ),
      { numRuns: 2_000 },
    );
  });
});
