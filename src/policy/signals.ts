import type { Cents, HealthSignals, Tier } from "../domain.js";

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const stdev = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

const pct = (now: number, before: number) => (before > 0 ? (now - before) / before : 0);

/**
 * Turns a borrower's weekly revenue history into explainable health signals.
 * Deterministic: the LLM narrates these, it never computes them.
 */
export function computeSignals(history: Cents[], window = 3): HealthSignals {
  const recent = history.slice(-window);
  const prior = history.slice(-2 * window, -window);
  const avg = mean(recent);
  const last = history.at(-1) ?? 0;
  const beforeLast = history.slice(-window - 1, -1);

  const trendPct = prior.length >= 2 ? pct(avg, mean(prior)) : 0;
  const volatility = avg > 0 ? stdev(recent) / avg : 0;
  const lastWeekChangePct = beforeLast.length >= 2 ? pct(last, mean(beforeLast)) : 0;

  const reasons: string[] = [];
  let tier: Tier = "healthy";

  if (lastWeekChangePct <= -0.35) reasons.push(`last week revenue ${(lastWeekChangePct * 100).toFixed(0)}% vs recent average`);
  if (trendPct <= -0.25) reasons.push(`${window}-week revenue trend ${(trendPct * 100).toFixed(0)}%`);
  if (reasons.length) tier = "stressed";
  else {
    if (trendPct <= -0.05) reasons.push(`revenue softening ${(trendPct * 100).toFixed(0)}% over ${window} weeks`);
    if (volatility > 0.35) reasons.push(`volatile revenue (cv ${volatility.toFixed(2)})`);
    if (history.length < 3) reasons.push(`only ${history.length} week(s) of history`);
    if (reasons.length) tier = "watch";
  }
  if (tier === "healthy") reasons.push(`stable revenue, trend ${(trendPct * 100).toFixed(0)}%`);

  return {
    avgWeeklyRevenue: Math.round(avg),
    trendPct,
    volatility,
    lastWeekChangePct,
    weeksObserved: history.length,
    tier,
    reasons,
  };
}
