import { describe, expect, it } from "vitest";
import { computeSignals } from "../src/policy/signals.js";
import { reconcilePortfolio } from "../src/reconcile/portfolio.js";
import { runScenario, PLATFORM } from "../src/sim/run.js";
import { demoScenario } from "../src/sim/scenario.js";
import { usd } from "../src/domain.js";

const steady = [usd(10_000), usd(10_100), usd(9_900), usd(10_000), usd(10_050), usd(9_950)];

describe("underwriting: refunds and chargebacks", () => {
  it("leaves a borrower healthy at normal refund levels", () => {
    expect(computeSignals(steady, 3, [0.02]).tier).toBe("healthy");
  });

  it("puts a borrower on watch when refunds pass 6% of sales", () => {
    const s = computeSignals(steady, 3, [0.02, 0.07]);
    expect(s.tier).toBe("watch");
    expect(s.reasons).toContain("refunds 7.0% of sales");
  });

  it("marks a borrower stressed when refunds and chargebacks pass 12%", () => {
    expect(computeSignals(steady, 3, [0.13]).tier).toBe("stressed");
  });

  it("freezes Nimbus earlier in the demo when its refunds climb after the shock", async () => {
    const run = await runScenario(demoScenario({ nimbusRefundPct: 14 }));
    const review = run.ledger.decisions.find((d) => d.type === "health-review" && d.borrowerId === "nimbus")!;
    expect(review.memo).toContain("refunds and chargebacks 14.0% of sales");
  });
});

describe("revenue verified against the bank's deposits", () => {
  it("records a matching check for every borrower, every week, in the canonical demo", async () => {
    const run = await runScenario(demoScenario());
    expect(run.ledger.revenueChecks).toHaveLength(30);
    expect(run.ledger.revenueChecks.every((c) => c.match)).toBe(true);
  });

  it("collects only on what the bank confirms when a customer payment bounces, and still reconciles", async () => {
    const s = demoScenario({ bouncedPayment: true });
    const run = await runScenario(s);
    const check = run.ledger.revenueChecks.find((c) => c.borrowerId === "ledgerly" && c.week === 5)!;
    expect(check.match).toBe(false);
    expect(check.confirmed).toBeLessThan(check.expected);
    expect(run.reports.every((r) => r.floorHeld && r.reconciled)).toBe(true);
    const portfolio = await reconcilePortfolio({ bank: run.bank, ledger: run.ledger, borrowers: s.borrowers, staged: run.staged, openingWallets: run.openingWallets, platformAccountId: PLATFORM });
    expect(portfolio.allMatch).toBe(true);
  });
});

describe("platform controls", () => {
  it("raising the approval line lets Kopi's $22K advance through without a person", async () => {
    const run = await runScenario(demoScenario({ approvalLineDollars: 30_000 }));
    const kopi = run.ledger.decisions.find((d) => d.type === "advance-request" && d.borrowerId === "kopi")!;
    expect(kopi.approval?.required).toBe(false);
  });

  it("a lower per-borrower limit shrinks what Kopi can draw", async () => {
    const run = await runScenario(demoScenario({ maxExposurePct: 10 }));
    const kopi = run.ledger.decisions.find((d) => d.type === "advance-request" && d.borrowerId === "kopi")!;
    const chosen = kopi.options!.find((o) => o.kind === kopi.chosen)!;
    expect(chosen.amount).toBeLessThanOrEqual(usd(10_000));
  });
});

describe("merchant portal requests", () => {
  it("decides a request sent from the portal in the week it was sent", async () => {
    const run = await runScenario(demoScenario({ portalRequests: [{ borrowerId: "ledgerly", amountDollars: 5_000, week: 10 }] }));
    const d = run.ledger.decisions.find((x) => x.type === "advance-request" && (x.inputs.request as { id: string }).id === "req_portal_1");
    expect(d).toBeDefined();
    expect(d!.week).toBe(10);
    expect(run.reports.every((r) => r.floorHeld)).toBe(true);
  });
});
