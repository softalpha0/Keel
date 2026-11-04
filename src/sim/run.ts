import type { BankAdapter } from "../bank/types.js";
import { MockBank } from "../bank/mock.js";
import { LendingAgent, type Approver, type Settlement, type WeekReport } from "../agent/lending-agent.js";
import { RulesAdvisor, type Advisor } from "../agent/advisor.js";
import { Ledger } from "../ledger.js";
import { defaultPolicy, type PolicyConfig } from "../policy/engine.js";
import type { Scenario } from "./scenario.js";
import { PLATFORM_CURRENCY, type Borrower, type Cents } from "../domain.js";

export const PLATFORM = "acct_platform";

export interface RunOptions {
  bank?: BankAdapter;
  advisor?: Advisor;
  approver?: Approver;
  policy?: Partial<PolicyConfig>;
  platformAccountId?: string;
  /**
   * Check each week's revenue against the bank's own deposit records, where the bank can list them.
   * "enforce" (default for the mock bank) collects only on confirmed money; "report" records the check only.
   */
  verifyDeposits?: "enforce" | "report" | "off";
  onWeek?: (r: WeekReport, agent: LendingAgent) => void;
}

/** Customer revenue the simulation put into a borrower wallet. Needed to reconcile borrower wallets, not just the platform. */
export interface StagedRevenue {
  week: number;
  borrowerId: string;
  currency: string;
  amount: Cents;
}

export interface Simulation {
  agent: LendingAgent;
  ledger: Ledger;
  bank: BankAdapter;
  staged: StagedRevenue[];
  /** Every borrower wallet Keel touches (`accountId|currency`), before week 1. */
  openingWallets: Map<string, Cents>;
  readonly week: number;
  readonly done: boolean;
  /** Runs the next week. Resolves null once the scenario is finished. */
  step(): Promise<WeekReport | null>;
}

/** Builds the agent for a scenario without running it, so a UI can step week by week. */
export async function createSimulation(s: Scenario, opts: RunOptions = {}): Promise<Simulation> {
  const platform = opts.platformAccountId ?? PLATFORM;
  const bank = opts.bank ?? new MockBank({ [platform]: s.fundSize });
  if (bank instanceof MockBank) {
    for (const d of s.bouncedDeposits ?? []) {
      const acct = s.borrowers.find((b) => b.id === d.borrowerId)?.accountId;
      bank.injectShortDeposit((a, key) => a === acct && key === `rev:${d.borrowerId}:w${d.week}`, d.share);
    }
    for (const w of s.lostResponseWeeks) bank.injectLostResponse((r) => r.idempotencyKey.startsWith("collect:") && r.idempotencyKey.endsWith(`:w${w}`));
  }

  const cfg = { ...defaultPolicy(s.fundSize, s.reserveFloor), ...s.policy, ...opts.policy };
  const ledger = new Ledger(await bank.getBalance(platform));
  ledger.commitments.push(...s.pipeline.map((c) => ({ ...c })));
  const agent = new LendingAgent(
    bank,
    ledger,
    cfg,
    new Map(s.borrowers.map((b) => [b.id, b])),
    platform,
    opts.advisor ?? new RulesAdvisor(),
    opts.approver,
  );

  const staged: StagedRevenue[] = [];
  const openingWallets = new Map<string, Cents>();
  for (const b of s.borrowers) {
    // Sales and repayments use the borrower's currency; advances arrive in USD.
    for (const ccy of new Set([b.currency ?? PLATFORM_CURRENCY, PLATFORM_CURRENCY])) {
      openingWallets.set(`${b.accountId}|${ccy}`, await bank.getBalance(b.accountId, ccy));
    }
  }

  const verify = opts.verifyDeposits ?? (bank instanceof MockBank ? "enforce" : "report");
  // Deposits already counted, so a slow bank listing never counts the same money twice.
  const counted = new Set<string>();
  let week = 0;
  return {
    agent,
    ledger,
    bank,
    staged,
    openingWallets,
    get week() {
      return week;
    },
    get done() {
      return week >= s.weeks;
    },
    async step() {
      if (week >= s.weeks) return null;
      const w = week + 1;
      const revenue = new Map<string, number>();
      const received = new Map<string, number>();
      const late: Settlement["late"] = [];
      const deposits = new Map<string, { amount: Cents; ids: string[] }>();
      const refundRate = new Map<string, number>();
      const usdPer = (b: Borrower, week: number) => (b.currency && b.currency !== PLATFORM_CURRENCY ? s.fx[b.currency]!(week) : 1);
      // Sales in the borrower's own currency.
      const sold = (b: Borrower, week: number) => Math.round(s.revenue(b.id, week) / usdPer(b, week));
      if (bank instanceof MockBank) for (const [ccy, rate] of Object.entries(s.fx)) bank.setRate(ccy, PLATFORM_CURRENCY, rate(w));
      for (const b of s.borrowers) {
        const amount = sold(b, w);
        revenue.set(b.id, amount);
        const delayed = s.latePayments.filter((l) => l.borrowerId === b.id && l.week === w).reduce((x, l) => x + Math.round(amount * l.share), 0);
        received.set(b.id, amount - delayed);
        for (const l of s.latePayments.filter((l) => l.borrowerId === b.id && l.arrivesWeek === w)) {
          late.push({ borrowerId: b.id, forWeek: l.week, amount: Math.round(sold(b, l.week) * l.share) });
        }
        // Customer payments land in the borrower's account before we collect from it.
        const landed = amount - delayed + late.filter((l) => l.borrowerId === b.id).reduce((x, l) => x + l.amount, 0);
        const ccy = b.currency ?? PLATFORM_CURRENCY;
        const before = new Date();
        await bank.stageRevenue(b.accountId, landed, `rev:${b.id}:w${w}`, b.currency);
        if (s.refunds) refundRate.set(b.id, s.refunds(b.id, w));
        // Ask the bank what actually arrived, instead of trusting the sales feed.
        const seen = bank.listDeposits && verify !== "off" ? await readDeposits(bank, b.accountId, ccy, before, counted, landed) : null;
        if (seen) deposits.set(b.id, seen);
        staged.push({ week: w, borrowerId: b.id, currency: ccy, amount: seen && verify === "enforce" ? seen.amount : landed });
      }
      const r = await agent.runWeek(w, revenue, s.requests.filter((q) => q.week === w), { received, late, deposits, enforceDeposits: verify === "enforce", refundRate });
      week = w;
      opts.onWeek?.(r, agent);
      return r;
    },
  };
}

/**
 * New deposits for one account since `before`. The bank may take a moment to list a deposit, so
 * retry briefly while less than expected shows up. Returns null when the bank lists nothing at all
 * (verification unavailable), so a missing feature never blocks collections.
 */
async function readDeposits(bank: BankAdapter, accountId: string, currency: string, before: Date, counted: Set<string>, expected: Cents) {
  const tries = bank instanceof MockBank ? 1 : 3;
  let fresh: { id: string; amount: Cents }[] = [];
  for (let i = 0; i < tries; i++) {
    try {
      fresh = (await bank.listDeposits!(accountId, currency, before)).filter((d) => !counted.has(d.id));
    } catch {
      return null;
    }
    if (fresh.reduce((s, d) => s + d.amount, 0) >= expected) break;
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 2_000));
  }
  if (!fresh.length && expected > 0) return null;
  for (const d of fresh) counted.add(d.id);
  return { amount: fresh.reduce((s, d) => s + d.amount, 0), ids: fresh.map((d) => d.id) };
}

export async function runScenario(s: Scenario, opts: RunOptions = {}) {
  const sim = await createSimulation(s, opts);
  const reports: WeekReport[] = [];
  for (let r = await sim.step(); r; r = await sim.step()) reports.push(r);
  return { agent: sim.agent, ledger: sim.ledger, reports, bank: sim.bank, staged: sim.staged, openingWallets: sim.openingWallets };
}
