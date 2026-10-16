import { bps, fmt, type AdvanceOption, type AdvanceRequest, type Borrower, type Cents, type Tier } from "../domain.js";
import type { BankAdapter } from "../bank/types.js";
import { Executor } from "../executor.js";
import type { DecisionRecord, Ledger } from "../ledger.js";
import { buildOptions, FloorBreachError, rankOptions, repaymentDue, type DecisionContext, type PolicyConfig } from "../policy/engine.js";
import { computeSignals } from "../policy/signals.js";
import type { Advisor } from "./advisor.js";

export interface Approver {
  approve(record: DecisionRecord, option: AdvanceOption): Promise<{ approved: boolean; by: string }>;
}

/** Demo approver. Swap for a Slack/WhatsApp button in the UI. */
export const autoApprover: Approver = {
  async approve() {
    return { approved: true, by: "demo-operator" };
  },
};

export interface WeekReport {
  week: number;
  platformBalance: Cents;
  expectedBalance: Cents;
  reconciled: boolean;
  floorHeld: boolean;
}

/**
 * The weekly loop: observe -> collect -> review health -> fund commitments -> decide requests -> reconcile.
 * Every money movement goes through the Executor; every decision lands in the ledger with its inputs.
 */
export class LendingAgent {
  private executor: Executor;

  constructor(
    private bank: BankAdapter,
    readonly ledger: Ledger,
    readonly cfg: PolicyConfig,
    readonly borrowers: Map<string, Borrower>,
    private platformAccountId: string,
    private advisor: Advisor,
    private approver: Approver = autoApprover,
  ) {
    this.executor = new Executor(bank, ledger, cfg, platformAccountId);
  }

  async runWeek(week: number, revenue: Map<string, Cents>, requests: AdvanceRequest[]): Promise<WeekReport> {
    this.observe(week, revenue);
    await this.collect(week, revenue);
    this.reviewHealth(week);
    await this.fundCommitments(week);
    for (const req of requests) await this.decide(req);
    return this.reconcile(week);
  }

  private observe(week: number, revenue: Map<string, Cents>) {
    for (const [id, amount] of revenue) {
      const hist = this.ledger.revenue.get(id) ?? [];
      hist.push(amount);
      this.ledger.revenue.set(id, hist);
    }
  }

  private async collect(week: number, revenue: Map<string, Cents>) {
    // Read each borrower's wallet once; several advances may draw on it this week.
    const available = new Map<string, Cents>();
    for (const adv of this.ledger.advances) {
      if (adv.outstanding <= 0 || adv.disbursedWeek >= week) continue;
      const b = this.borrowers.get(adv.borrowerId)!;
      const due = repaymentDue(revenue.get(b.id) ?? 0, b.holdbackBps, adv.outstanding);
      if (due <= 0) continue;
      if (!available.has(b.id)) available.set(b.id, await this.bank.getBalance(b.accountId));
      const amount = Math.min(due, available.get(b.id)!);

      // Never send a charge the wallet cannot cover: record the gap as a receivable instead.
      if (amount < due) {
        const shortfall = due - amount;
        this.ledger.receivables.push({ week, advanceId: adv.id, borrowerId: b.id, amount: shortfall });
        this.ledger.log(week, `${b.name} wallet short by ${fmt(shortfall)} for repayment on ${adv.id}; recorded as a receivable`, "warn");
      }
      if (amount <= 0) continue;

      const r = await this.executor.move({
        kind: "collect",
        borrowerId: b.id,
        borrowerAccountId: b.accountId,
        amount,
        idempotencyKey: `collect:${adv.id}:w${week}`,
        reference: `Repayment ${adv.id} week ${week}`,
        week,
      });
      if (r.status === "settled") {
        adv.outstanding -= amount;
        available.set(b.id, available.get(b.id)! - amount);
      } else this.ledger.log(week, `Collection ${r.idempotencyKey} ${r.status}`, "warn");
    }
  }

  private reviewHealth(week: number) {
    for (const b of this.borrowers.values()) {
      const prev = this.ledger.signals.get(b.id)?.tier;
      const sig = computeSignals(this.ledger.revenue.get(b.id) ?? []);
      this.ledger.signals.set(b.id, sig);
      if (sig.tier !== "stressed" || prev === "stressed") continue;

      // Newly stressed: cancel anything promised but not yet paid out.
      const cancelled = this.ledger.commitments.filter((c) => c.borrowerId === b.id);
      this.ledger.commitments = this.ledger.commitments.filter((c) => c.borrowerId !== b.id);
      const memo =
        `${b.name} moved ${prev ?? "new"} → stressed (${sig.reasons.join("; ")}). New advances frozen` +
        (cancelled.length ? `, cancelled ${cancelled.length} pending advance(s) worth ${fmt(cancelled.reduce((s, c) => s + c.amount, 0))}` : "") +
        `. Repayments continue at ${b.holdbackBps / 100}% of revenue, so they shrink with revenue instead of forcing a default; ${fmt(this.ledger.outstanding(b.id))} outstanding.`;
      this.ledger.decisions.push({
        week,
        type: "health-review",
        borrowerId: b.id,
        inputs: { previousTier: prev, signals: sig, cancelled },
        decidedBy: "rules",
        memo,
        receipts: [],
      });
      this.ledger.log(week, memo, "warn");
    }
  }

  private async fundCommitments(week: number) {
    for (const c of this.ledger.commitments.filter((c) => c.week <= week)) {
      try {
        await this.disburse(week, c.borrowerId, c.amount, `commit:${c.id}`);
      } catch (err) {
        if (!(err instanceof FloorBreachError)) throw err;
        c.week = week + 1;
        this.ledger.log(week, `Held pending advance for ${this.borrowers.get(c.borrowerId)?.name ?? c.borrowerId} to week ${c.week}: ${err.message}`, "warn");
        continue;
      }
      this.ledger.commitments = this.ledger.commitments.filter((x) => x.id !== c.id);
      this.ledger.log(week, `Funded pending advance for ${this.borrowers.get(c.borrowerId)?.name ?? c.borrowerId}: ${fmt(c.amount)} (${c.id})`);
    }
  }

  private context(week: number, balance: Cents): DecisionContext {
    const exposure = new Map<string, Cents>();
    let weekly = 0;
    for (const b of this.borrowers.values()) {
      exposure.set(b.id, this.ledger.exposure(b.id));
      const sig = this.ledger.signals.get(b.id);
      // Haircut projected collections by 20% so delays are planned conservatively.
      if (sig) weekly += Math.min(bps(sig.avgWeeklyRevenue, b.holdbackBps), this.ledger.outstanding(b.id));
    }
    return {
      week,
      platformBalance: balance,
      commitments: [...this.ledger.commitments],
      borrowers: this.borrowers,
      signals: this.ledger.signals,
      exposure,
      projectedWeeklyCollections: Math.floor(weekly * 0.8),
    };
  }

  async decide(req: AdvanceRequest): Promise<DecisionRecord> {
    const b = this.borrowers.get(req.borrowerId)!;
    const balance = await this.bank.getBalance(this.platformAccountId);
    const ctx = this.context(req.week, balance);
    const options = buildOptions(req, ctx, this.cfg);
    const feasible = rankOptions(options);
    const sig = this.ledger.signals.get(b.id)!;

    const decision = await this.advisor.decide({
      week: req.week,
      borrower: b,
      signals: sig,
      requested: req.amount,
      feasible,
      portfolioSummary: this.portfolioSummary(balance),
    });
    // Guardrail: whatever the advisor says, only a policy-feasible option can execute.
    const chosen = feasible.find((o) => o.kind === decision.kind) ?? feasible[0]!;

    const record: DecisionRecord = {
      week: req.week,
      type: "advance-request",
      borrowerId: b.id,
      inputs: { request: req, platformBalance: balance, reserveFloor: this.cfg.reserveFloor, signals: sig, commitments: ctx.commitments },
      options,
      chosen: chosen.kind,
      decidedBy: decision.decidedBy,
      memo: decision.memo,
      receipts: [],
    };

    const movesMoney = chosen.kind !== "decline";
    const required = movesMoney && (chosen.amount > this.cfg.approvalThreshold || chosen.reallocations.length > 0);
    if (required) {
      const a = await this.approver.approve(record, chosen);
      record.approval = { required, ...a };
      if (!a.approved) {
        record.chosen = "decline";
        record.memo += ` Human reviewer ${a.by} rejected; declined.`;
      }
    } else {
      record.approval = { required: false, approved: true, by: "policy" };
    }

    if (record.approval.approved && movesMoney) await this.apply(req, chosen, record);
    this.ledger.decisions.push(record);
    this.ledger.log(req.week, `${b.name} requested ${fmt(req.amount)} → ${record.chosen}${movesMoney ? ` ${fmt(chosen.amount)} (week ${chosen.executeWeek})` : ""} [${decision.decidedBy}]`);
    return record;
  }

  private async apply(req: AdvanceRequest, o: AdvanceOption, record: DecisionRecord) {
    for (const r of o.reallocations) {
      const c = this.ledger.commitments.find((x) => x.id === r.commitmentId);
      if (!c) continue;
      c.amount -= r.reduceBy;
      if (c.amount <= 0) this.ledger.commitments = this.ledger.commitments.filter((x) => x.id !== c.id);
      this.ledger.log(req.week, `Reallocated ${fmt(r.reduceBy)} from ${this.borrowers.get(r.fromBorrowerId)?.name ?? r.fromBorrowerId}'s pending advance (${r.commitmentId})`);
    }
    if (o.executeWeek > req.week) {
      const id = this.ledger.nextId("cmt");
      this.ledger.commitments.push({ id, borrowerId: req.borrowerId, amount: o.amount, week: o.executeWeek, reason: `delayed ${req.id}` });
      return;
    }
    const receipt = await this.disburse(req.week, req.borrowerId, o.amount, `req:${req.id}`);
    record.receipts.push(receipt);
  }

  private async disburse(week: number, borrowerId: string, amount: Cents, source: string): Promise<string> {
    const b = this.borrowers.get(borrowerId)!;
    const id = this.ledger.nextId("adv");
    const r = await this.executor.move({
      kind: "disburse",
      borrowerId,
      borrowerAccountId: b.accountId,
      amount,
      idempotencyKey: `disburse:${source}`,
      reference: `Advance ${id} to ${b.name}`,
      week,
    });
    if (r.status !== "settled") throw new Error(`disbursement ${r.idempotencyKey} ${r.status}`);
    const fee = bps(amount, this.cfg.feeBps);
    this.ledger.advances.push({ id, borrowerId, principal: amount, fee, outstanding: amount + fee, disbursedWeek: week });
    return r.transferId;
  }

  private portfolioSummary(balance: Cents): string {
    const parts = [...this.borrowers.values()].map((b) => {
      const tier: Tier | undefined = this.ledger.signals.get(b.id)?.tier;
      return `${b.id} ${tier ?? "new"} owes ${fmt(this.ledger.outstanding(b.id))}`;
    });
    const committed = this.ledger.commitments.reduce((s, c) => s + c.amount, 0);
    return `platform cash ${fmt(balance)}, floor ${fmt(this.cfg.reserveFloor)}, committed ${fmt(committed)}; ${parts.join("; ")}`;
  }

  private async reconcile(week: number): Promise<WeekReport> {
    const platformBalance = await this.bank.getBalance(this.platformAccountId);
    const expectedBalance = this.ledger.expectedPlatformBalance();
    const reconciled = platformBalance === expectedBalance;
    const floorHeld = platformBalance >= this.cfg.reserveFloor;
    if (!reconciled) this.ledger.log(week, `RECONCILIATION MISMATCH bank ${fmt(platformBalance)} vs ledger ${fmt(expectedBalance)}`, "warn");
    return { week, platformBalance, expectedBalance, reconciled, floorHeld };
  }
}
