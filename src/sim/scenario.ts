import { usd, type AdvanceRequest, type Borrower, type Cents, type Commitment } from "../domain.js";

/** Small seeded PRNG so every demo run is identical. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Scenario {
  weeks: number;
  fundSize: Cents;
  reserveFloor: Cents;
  borrowers: Borrower[];
  revenue: (borrowerId: string, week: number) => Cents;
  requests: AdvanceRequest[];
  /** Advances approved before the run starts, still waiting to be paid out. */
  pipeline: Commitment[];
  /** Weeks where the bank "loses" a collection response, to show idempotent retries. */
  lostResponseWeeks: number[];
  /** Customer payments that settle after the week they were earned (the Kit 7 underpayment). */
  latePayments: LatePayment[];
}

export interface LatePayment {
  borrowerId: string;
  week: number;
  /** Share of that week's sales that settles late (0-1). */
  share: number;
  arrivesWeek: number;
}

/** Knobs the console's what-if panel turns. Defaults reproduce the canonical demo. */
export interface ScenarioParams {
  seed: number;
  /** Share of Nimbus revenue lost in the demand shock (0-0.9). */
  shockPct: number;
  shockWeek: number;
  reserveFloorDollars: number;
  /** Kopi weekly revenue decline, as a fraction of week-0 revenue. */
  kopiDecline: number;
}

export const defaultParams: ScenarioParams = {
  seed: 7,
  shockPct: 1 - 5_200 / 14_000,
  shockWeek: 7,
  reserveFloorDollars: 30_000,
  kopiDecline: 0.04,
};

export function demoScenario(overrides: Partial<ScenarioParams> = {}): Scenario {
  const p = { ...defaultParams, ...overrides };
  const rand = mulberry32(p.seed);
  const noise = () => 1 + (rand() - 0.5) * 0.1; // +/-5%
  const curves: Record<string, (w: number) => number> = {
    // Steady roaster whose sales are slowly softening -> "watch"
    kopi: (w) => 9_000 * Math.max(0.2, 1 - p.kopiDecline * w),
    // Apparel brand that is strong until a demand shock (week 7 by default)
    nimbus: (w) => (w < p.shockWeek ? 14_000 : 14_000 * (1 - p.shockPct)),
    // B2B SaaS growing ~6% a week
    ledgerly: (w) => 6_000 * 1.06 ** w,
  };
  const series = new Map<string, Cents[]>();
  for (const id of Object.keys(curves)) {
    series.set(id, Array.from({ length: 13 }, (_, w) => usd(curves[id]!(w) * noise())));
  }

  return {
    weeks: 10,
    fundSize: usd(100_000),
    reserveFloor: usd(p.reserveFloorDollars),
    borrowers: [
      { id: "kopi", name: "Kopi Roasters", accountId: "acct_kopi", holdbackBps: 1_000 },
      { id: "nimbus", name: "Nimbus Apparel", accountId: "acct_nimbus", holdbackBps: 1_200 },
      { id: "ledgerly", name: "Ledgerly SaaS", accountId: "acct_ledgerly", holdbackBps: 1_000 },
    ],
    revenue: (id, week) => series.get(id)?.[week] ?? 0,
    requests: [
      { id: "req_1", borrowerId: "kopi", amount: usd(22_000), week: 3 },
      { id: "req_2", borrowerId: "ledgerly", amount: usd(20_000), week: 4 },
      // The Kit 7 moment: the full third advance would breach the reserve floor.
      { id: "req_3", borrowerId: "nimbus", amount: usd(26_000), week: 5 },
      // After the demand shock: the agent should refuse to lend more.
      { id: "req_4", borrowerId: "nimbus", amount: usd(10_000), week: 8 },
    ],
    pipeline: [{ id: "cmt_pipeline_kopi", borrowerId: "kopi", amount: usd(8_000), week: 6, reason: "approved top-up" }],
    lostResponseWeeks: [6],
    // Ledgerly's enterprise customers pay 60% of week 6 invoices a week late.
    latePayments: [{ borrowerId: "ledgerly", week: 6, share: 0.6, arrivesWeek: 7 }],
  };
}
