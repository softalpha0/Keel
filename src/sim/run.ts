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
    for (const w of s.lostResponseWeeks) bank.injectLostResponse((r) => r.idempotencyKey.startsWith("collect:") && r.idempotencyKey.endsWith(`:w${w}`));
  }

  const cfg = { ...defaultPolicy(s.fundSize, s.reserveFloor), ...opts.policy };
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
        await bank.stageRevenue(b.accountId, landed, `rev:${b.id}:w${w}`, b.currency);
        staged.push({ week: w, borrowerId: b.id, currency: b.currency ?? PLATFORM_CURRENCY, amount: landed });
      }
      const r = await agent.runWeek(w, revenue, s.requests.filter((q) => q.week === w), { received, late });
      week = w;
      opts.onWeek?.(r, agent);
      return r;
    },
  };
}

export async function runScenario(s: Scenario, opts: RunOptions = {}) {
  const sim = await createSimulation(s, opts);
  const reports: WeekReport[] = [];
  for (let r = await sim.step(); r; r = await sim.step()) reports.push(r);
  return { agent: sim.agent, ledger: sim.ledger, reports, bank: sim.bank, staged: sim.staged, openingWallets: sim.openingWallets };
}
