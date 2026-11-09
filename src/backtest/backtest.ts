import { bps, usd, type Cents } from "../domain.js";
import { borrowerCapacity, defaultPolicy, type PolicyConfig } from "../policy/engine.js";
import { computeSignals } from "../policy/signals.js";
import { ARCHETYPES, syntheticHistory, type Archetype, type MerchantHistory } from "./history.js";

export interface StrategyResult {
  advances: number;
  merchantsFunded: number;
  lent: Cents;
  collected: Cents;
  /** Principal + fee still unpaid at the end of the horizon, written off. */
  writtenOff: Cents;
  /** Written-off principal as a share of principal lent. */
  lossRate: number;
  /** (collected - principal lent) / principal lent. */
  netReturn: number;
  /** Median weeks to repay an advance in full, among those that did. */
  medianPaybackWeeks: number;
  byArchetype: Record<Archetype, { lent: Cents; writtenOff: Cents; lossRate: number; advances: number }>;
}

export interface BacktestResult {
  merchants: number;
  lendingWeeks: number;
  horizonWeeks: number;
  holdbackBps: number;
  feeBps: number;
  keel: StrategyResult;
  naive: StrategyResult;
}

export interface BacktestOptions {
  merchants?: number;
  seed?: number;
  /** Platform rules to test, on top of Keel's defaults. */
  policy?: Partial<PolicyConfig>;
  holdbackBps?: number;
}

/** Weeks at which each merchant asks for money: early, and twice more if they want a top-up. */
const REQUEST_WEEKS = [6, 18, 30, 42];
const LENDING_WEEKS = 52;
/** At a 10% share, four weeks of sales take about 43 weeks to repay; give every advance a full year. */
const TAIL_WEEKS = 60;

/**
 * Replays the same merchant history through two lenders and keeps score:
 * - Keel: sizes each advance with its real health signals and capacity rule (tiers, refunds,
 *   exposure); a stressed merchant gets nothing.
 * - Naive: the same sizing rule (N weeks of average sales) for anyone who asks, no health check.
 * Repayment is the same revenue share for both. Anything still owed at the end of the horizon
 * (at least a year after the last advance) is written off.
 */
export function backtest(opts: BacktestOptions = {}): BacktestResult {
  const history = syntheticHistory(opts.merchants ?? 300, LENDING_WEEKS + TAIL_WEEKS, opts.seed ?? 11);
  const cfg: PolicyConfig = { ...defaultPolicy(usd(100_000_000), 0), ...opts.policy };
  // The backtest asks about credit quality, not cash: give the fund room so the floor never binds,
  // but keep the per-borrower limit as a share of a $100K book, like the demo.
  const exposureCap = bps(usd(100_000), cfg.maxBorrowerExposureBps);
  const holdback = opts.holdbackBps ?? 1_000;
  const run = (smart: boolean) => simulate(history, cfg, holdback, smart, exposureCap);
  return {
    merchants: history.length,
    lendingWeeks: LENDING_WEEKS,
    horizonWeeks: LENDING_WEEKS + TAIL_WEEKS,
    holdbackBps: holdback,
    feeBps: cfg.feeBps,
    keel: run(true),
    naive: run(false),
  };
}

function simulate(history: MerchantHistory[], cfg: PolicyConfig, holdbackBps: number, smart: boolean, exposureCap: Cents): StrategyResult {
  const byArchetype = Object.fromEntries(ARCHETYPES.map((a) => [a.kind, { lent: 0, writtenOff: 0, lossRate: 0, advances: 0 }])) as StrategyResult["byArchetype"];
  let advances = 0;
  let lent = 0;
  let collected = 0;
  let writtenOffPrincipal = 0;
  let writtenOff = 0;
  const funded = new Set<string>();
  const paybacks: number[] = [];

  for (const m of history) {
    const book: { principal: Cents; owed: Cents; week: number }[] = [];
    for (let w = 0; w < m.sales.length; w++) {
      // Collect this week's share of sales net of refunds, oldest advance first.
      let share = bps(Math.round(m.sales[w]! * (1 - m.refundRate[w]!)), holdbackBps);
      for (const a of book) {
        if (share <= 0) break;
        if (a.owed <= 0) continue;
        const take = Math.min(share, a.owed);
        a.owed -= take;
        share -= take;
        collected += take;
        if (a.owed === 0) paybacks.push(w - a.week);
      }
      if (w >= LENDING_WEEKS || !REQUEST_WEEKS.includes(w)) continue;

      const seen = m.sales.slice(0, w);
      const avg = seen.slice(-3).reduce((s, x) => s + x, 0) / 3;
      // Merchants ask for more than a careful lender would give: six weeks of sales.
      const ask = Math.round(avg * 6);
      const owedNow = book.reduce((s, a) => s + a.owed, 0);
      let amount: Cents;
      if (smart) {
        const sig = computeSignals(seen, 3, m.refundRate.slice(0, w));
        const exposure = book.reduce((s, a) => s + Math.round((a.owed * a.principal) / Math.round(a.principal * (1 + cfg.feeBps / 10_000))), 0);
        const cap = Math.min(borrowerCapacity(sig, exposure, cfg), Math.max(0, exposureCap - exposure));
        amount = Math.min(ask, Math.floor(cap / 10_000) * 10_000);
      } else {
        // Same sizing rule, no health check, and it tops up whatever is still owed.
        amount = Math.floor((avg * cfg.advanceMultipleWeeks) / 10_000) * 10_000;
        if (owedNow > avg * 8) amount = 0; // even a naive lender stops at a very large balance
      }
      if (amount < cfg.minAdvance) continue;
      const fee = bps(amount, cfg.feeBps);
      book.push({ principal: amount, owed: amount + fee, week: w });
      advances++;
      lent += amount;
      funded.add(m.id);
      byArchetype[m.kind].lent += amount;
      byArchetype[m.kind].advances++;
    }
    for (const a of book) {
      if (a.owed <= 0) continue;
      const principalLeft = Math.min(a.principal, Math.round((a.owed * a.principal) / (a.principal + bps(a.principal, cfg.feeBps))));
      writtenOff += a.owed;
      writtenOffPrincipal += principalLeft;
      byArchetype[m.kind].writtenOff += principalLeft;
    }
  }
  for (const k of Object.keys(byArchetype) as Archetype[]) {
    const b = byArchetype[k];
    b.lossRate = b.lent ? b.writtenOff / b.lent : 0;
  }
  paybacks.sort((a, b) => a - b);
  return {
    advances,
    merchantsFunded: funded.size,
    lent,
    collected,
    writtenOff,
    lossRate: lent ? writtenOffPrincipal / lent : 0,
    netReturn: lent ? (collected - lent) / lent : 0,
    medianPaybackWeeks: paybacks.length ? paybacks[Math.floor(paybacks.length / 2)]! : 0,
    byArchetype,
  };
}
