import { usd, type Cents } from "../domain.js";

/** Small seeded PRNG so every backtest is identical. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Archetype = "steady" | "growing" | "seasonal" | "declining" | "shock" | "closure" | "refunds";

export const ARCHETYPES: { kind: Archetype; label: string; share: number; story: string }[] = [
  { kind: "steady", label: "Steady", share: 0.3, story: "Flat sales with normal noise" },
  { kind: "growing", label: "Growing", share: 0.15, story: "About 1% more sales each week" },
  { kind: "seasonal", label: "Seasonal", share: 0.15, story: "A strong half-year and a weak one" },
  { kind: "declining", label: "Slow decline", share: 0.12, story: "Sales fade a little every week" },
  { kind: "shock", label: "Demand shock", share: 0.12, story: "Sales drop by 70% one week and stay down" },
  { kind: "closure", label: "Closes down", share: 0.08, story: "Sales fall to zero within a month" },
  { kind: "refunds", label: "Refund spiral", share: 0.08, story: "Refunds climb past 15% of sales, then sales fall" },
];

export interface MerchantHistory {
  id: string;
  kind: Archetype;
  /** Weekly sales, in cents. */
  sales: Cents[];
  /** Weekly refunds and chargebacks as a share of sales (0-1). */
  refundRate: number[];
}

/**
 * A synthetic year and a half of weekly merchant history. It stands in for a platform's real
 * sales data, which is what a pilot would backtest on. Each archetype is a pattern a lender meets
 * in practice; the bad ones are what the health tiers are meant to catch.
 */
export function syntheticHistory(merchants = 300, weeks = 78, seed = 11): MerchantHistory[] {
  const rand = mulberry32(seed);
  const out: MerchantHistory[] = [];
  let n = 0;
  for (const a of ARCHETYPES) {
    const count = Math.round(merchants * a.share);
    for (let i = 0; i < count; i++) {
      const base = 3_000 + rand() * 17_000;
      // When trouble starts, for the archetypes that have it.
      const turn = 15 + Math.floor(rand() * 30);
      const phase = rand() * 52;
      const sales: Cents[] = [];
      const refundRate: number[] = [];
      for (let w = 0; w < weeks; w++) {
        const noise = 1 + (rand() - 0.5) * 0.16;
        let level = base;
        let refunds = 0.01 + rand() * 0.02;
        switch (a.kind) {
          case "growing":
            level = base * 1.01 ** w;
            break;
          case "seasonal":
            level = base * (1 + 0.35 * Math.sin((2 * Math.PI * (w + phase)) / 52));
            break;
          case "declining":
            level = base * Math.max(0.15, 1 - 0.012 * w);
            break;
          case "shock":
            level = w < turn ? base : base * 0.3;
            break;
          case "closure":
            level = w < turn ? base : base * Math.max(0, 1 - (w - turn + 1) / 4);
            break;
          case "refunds":
            if (w >= turn) refunds = Math.min(0.22, 0.03 + 0.02 * (w - turn));
            level = w < turn + 6 ? base : base * 0.55;
            break;
        }
        sales.push(usd(Math.max(0, level * noise)));
        refundRate.push(Number(refunds.toFixed(4)));
      }
      out.push({ id: `m${++n}`, kind: a.kind, sales, refundRate });
    }
  }
  return out;
}
