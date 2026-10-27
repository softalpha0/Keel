import {
  bps,
  fmt,
  possessive,
  type AdvanceOption,
  type AdvanceRequest,
  type Borrower,
  type Cents,
  type Commitment,
  type HealthSignals,
  type Reallocation,
  type Tier,
} from "../domain.js";

export interface PolicyConfig {
  /** Platform cash may never drop below this. */
  reserveFloor: Cents;
  /** Total capital the fund was raised with; exposure caps are a share of this. */
  fundSize: Cents;
  /** Advance sized as N weeks of average revenue (before the tier multiplier). */
  advanceMultipleWeeks: number;
  maxBorrowerExposureBps: number;
  /** Flat fee on principal, collected along with it. */
  feeBps: number;
  minAdvance: Cents;
  /** Decisions moving more than this need a human approval. */
  approvalThreshold: Cents;
  tierMultiplier: Record<Tier, number>;
  /** Expected loss rate by tier, in basis points of amount advanced. */
  lossRateBps: Record<Tier, number>;
  /** Cost of making a borrower wait, per week, in basis points of the amount. */
  delayCostBpsPerWeek: number;
  /** Relationship cost of shrinking a promised advance, in basis points. */
  reallocationCostBps: number;
  maxDelayWeeks: number;
}

export const defaultPolicy = (fundSize: Cents, reserveFloor: Cents): PolicyConfig => ({
  reserveFloor,
  fundSize,
  advanceMultipleWeeks: 4,
  maxBorrowerExposureBps: 3_500,
  feeBps: 800,
  minAdvance: 200_000,
  approvalThreshold: 2_000_000,
  tierMultiplier: { healthy: 1, watch: 0.6, stressed: 0 },
  lossRateBps: { healthy: 200, watch: 800, stressed: 3_000 },
  delayCostBpsPerWeek: 150,
  reallocationCostBps: 100,
  maxDelayWeeks: 4,
});

export class FloorBreachError extends Error {
  constructor(
    readonly balanceAfter: Cents,
    readonly floor: Cents,
  ) {
    super(`reserve floor breach: balance after ${fmt(balanceAfter)} < floor ${fmt(floor)}`);
  }
}

export function assertFloor(balanceAfter: Cents, cfg: PolicyConfig): void {
  if (balanceAfter < cfg.reserveFloor) throw new FloorBreachError(balanceAfter, cfg.reserveFloor);
}

/** Weekly revenue-share repayment: never more than the holdback, never more than owed. */
export function repaymentDue(revenue: Cents, holdbackBps: number, outstanding: Cents): Cents {
  return Math.max(0, Math.min(bps(revenue, holdbackBps), outstanding));
}

/** The most this borrower may receive right now, given health and existing exposure. */
export function borrowerCapacity(
  signals: HealthSignals,
  exposure: Cents,
  cfg: PolicyConfig,
): Cents {
  const byRevenue = Math.floor(
    signals.avgWeeklyRevenue * cfg.advanceMultipleWeeks * cfg.tierMultiplier[signals.tier],
  );
  const byExposure = bps(cfg.fundSize, cfg.maxBorrowerExposureBps);
  return Math.max(0, Math.min(byRevenue, byExposure) - exposure);
}

export interface DecisionContext {
  week: number;
  platformBalance: Cents;
  commitments: Commitment[];
  borrowers: Map<string, Borrower>;
  signals: Map<string, HealthSignals>;
  /** outstanding advances + commitments, per borrower */
  exposure: Map<string, Cents>;
  /** Conservative estimate of repayments collected per week across the book. */
  projectedWeeklyCollections: Cents;
}

const roundDown = (c: Cents, step: Cents = 10_000) => Math.floor(c / step) * step;

/**
 * Enumerates every way to answer an advance request and scores each with fixed rules.
 * Any option that would take platform cash below the reserve floor is marked infeasible.
 */
export function buildOptions(req: AdvanceRequest, ctx: DecisionContext, cfg: PolicyConfig): AdvanceOption[] {
  const sig = ctx.signals.get(req.borrowerId);
  if (!sig) throw new Error(`no signals for ${req.borrowerId}`);
  const tier = sig.tier;
  const capacity = borrowerCapacity(sig, ctx.exposure.get(req.borrowerId) ?? 0, cfg);
  const committed = ctx.commitments.reduce((s, c) => s + c.amount, 0);
  const free = ctx.platformBalance - cfg.reserveFloor - committed;
  const target = Math.min(req.amount, roundDown(capacity));

  const make = (
    kind: AdvanceOption["kind"],
    amount: Cents,
    opts: { delayWeeks?: number; reallocations?: Reallocation[]; rationale: string[] },
  ): AdvanceOption => {
    const delayWeeks = opts.delayWeeks ?? 0;
    const reallocations = opts.reallocations ?? [];
    const freed = reallocations.reduce((s, r) => s + r.reduceBy, 0);
    const inflow = delayWeeks * ctx.projectedWeeklyCollections;
    const projectedBalanceAfter = ctx.platformBalance + inflow - amount - (committed - freed);
    const breachesFloor = projectedBalanceAfter < cfg.reserveFloor;
    const expectedFee = bps(amount, cfg.feeBps);
    const expectedLoss = bps(amount, cfg.lossRateBps[tier]);
    let frictionCost = bps(amount, cfg.delayCostBpsPerWeek) * delayWeeks;
    for (const r of reallocations) {
      const fromTier = ctx.signals.get(r.fromBorrowerId)?.tier ?? "watch";
      // Shrinking someone else's promise forgoes their fee but also removes their risk.
      frictionCost +=
        bps(r.reduceBy, cfg.reallocationCostBps) + bps(r.reduceBy, cfg.feeBps) - bps(r.reduceBy, cfg.lossRateBps[fromTier]);
    }
    const feasible = kind === "decline" || (!breachesFloor && amount >= cfg.minAdvance);
    return {
      kind,
      amount,
      executeWeek: ctx.week + delayWeeks,
      reallocations,
      projectedBalanceAfter,
      breachesFloor,
      feasible,
      expectedFee,
      expectedLoss,
      frictionCost,
      score: kind === "decline" ? 0 : expectedFee - expectedLoss - frictionCost,
      rationale: opts.rationale,
    };
  };

  const options: AdvanceOption[] = [];
  const base = [`borrower tier ${tier}: ${sig.reasons.join("; ")}`, `capacity ${fmt(capacity)}, free capital ${fmt(free)}`];

  if (target < cfg.minAdvance) {
    options.push(make("decline", 0, { rationale: [...base, `capacity below minimum advance ${fmt(cfg.minAdvance)}`] }));
    return options;
  }

  options.push(make("full", target, { rationale: [...base, `fund ${fmt(target)} now`] }));

  const partialAmt = roundDown(Math.min(free, target - 1));
  if (partialAmt >= cfg.minAdvance && partialAmt < target) {
    options.push(make("partial", partialAmt, { rationale: [...base, `fund ${fmt(partialAmt)} now, the most free capital allows`] }));
  }

  if (ctx.projectedWeeklyCollections > 0) {
    for (let d = 1; d <= cfg.maxDelayWeeks; d++) {
      if (free + d * ctx.projectedWeeklyCollections >= target) {
        options.push(
          make("delay", target, {
            delayWeeks: d,
            rationale: [...base, `wait ${d} week(s) for projected collections of ${fmt(ctx.projectedWeeklyCollections)}/wk`],
          }),
        );
        break;
      }
    }
  }

  const shortfall = target - free;
  if (shortfall > 0) {
    // Take from the weakest borrowers' unfunded promises first, never from disbursed loans.
    const rank: Record<Tier, number> = { stressed: 0, watch: 1, healthy: 2 };
    const donors = ctx.commitments
      .filter((c) => c.borrowerId !== req.borrowerId)
      .sort(
        (a, b) =>
          rank[ctx.signals.get(a.borrowerId)?.tier ?? "watch"] - rank[ctx.signals.get(b.borrowerId)?.tier ?? "watch"] ||
          b.amount - a.amount,
      );
    const reallocations: Reallocation[] = [];
    let remaining = shortfall;
    for (const c of donors) {
      if (remaining <= 0) break;
      const take = Math.min(c.amount, remaining);
      reallocations.push({ commitmentId: c.id, fromBorrowerId: c.borrowerId, reduceBy: take });
      remaining -= take;
    }
    if (remaining <= 0) {
      const desc = reallocations
        .map((r) => `${fmt(r.reduceBy)} from ${possessive(ctx.borrowers.get(r.fromBorrowerId)?.name ?? r.fromBorrowerId)} pending advance`)
        .join(", ");
      options.push(make("reallocate", target, { reallocations, rationale: [...base, `fund ${fmt(target)} now by moving ${desc}`] }));
    }
  }

  options.push(make("decline", 0, { rationale: [...base, "decline this request"] }));
  return options;
}

/** Feasible options, best score first. Deterministic tie-break keeps runs replayable. */
export function rankOptions(options: AdvanceOption[]): AdvanceOption[] {
  const order: AdvanceOption["kind"][] = ["full", "reallocate", "partial", "delay", "decline"];
  return options
    .filter((o) => o.feasible)
    .sort((a, b) => b.score - a.score || order.indexOf(a.kind) - order.indexOf(b.kind));
}
