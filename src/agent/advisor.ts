import { fmt, type AdvanceOption, type Borrower, type HealthSignals } from "../domain.js";

export interface AdvisorInput {
  week: number;
  borrower: Borrower;
  signals: HealthSignals;
  requested: number;
  /** Only policy-approved options. The advisor cannot invent new ones. */
  feasible: AdvanceOption[];
  portfolioSummary: string;
}

export interface AdvisorDecision {
  kind: AdvanceOption["kind"];
  memo: string;
  decidedBy: "rules" | "claude";
}

export interface Advisor {
  decide(input: AdvisorInput): Promise<AdvisorDecision>;
}

export const describe = (o: AdvanceOption) =>
  `${o.kind}: ${fmt(o.amount)} in week ${o.executeWeek}, score ${fmt(o.score)} (fee ${fmt(o.expectedFee)}, expected loss ${fmt(o.expectedLoss)}, friction ${fmt(o.frictionCost)}), balance after ${fmt(o.projectedBalanceAfter)}`;

/** Picks the top-scored option and writes a templated memo. Used offline and as the fallback. */
export class RulesAdvisor implements Advisor {
  async decide(input: AdvisorInput): Promise<AdvisorDecision> {
    const best = input.feasible[0];
    if (!best) throw new Error("no feasible option (decline should always be feasible)");
    const alt = input.feasible.slice(1, 3).map((o) => `${o.kind} (${fmt(o.score)})`).join(", ");
    return {
      kind: best.kind,
      decidedBy: "rules",
      memo:
        `${input.borrower.name} asked for ${fmt(input.requested)}. Chose ${best.kind}: ${best.rationale.at(-1)}. ` +
        `Borrower is ${input.signals.tier} (${input.signals.reasons.join("; ")}). ` +
        `Reserve floor holds with ${fmt(best.projectedBalanceAfter)} projected.` +
        (alt ? ` Next best: ${alt}.` : ""),
    };
  }
}
