import type { DecisionRecord, Ledger } from "../../../src/ledger";
import type { ChartMarker } from "../components/CashChart";
import { money, moneyCompact, optionLabel } from "./format";

export interface StoryBeat extends ChartMarker {
  detail: string;
  decisionIndex?: number;
}

const borrowerName = (d: DecisionRecord) =>
  ({ kopi: "Kopi Roasters", nimbus: "Nimbus Apparel", ledgerly: "Ledgerly SaaS" })[d.borrowerId] ?? d.borrowerId;

/** The moments worth pointing at: hard decisions, incidents, and health changes. */
export function storyBeats(decisions: DecisionRecord[], events: Ledger["events"], opts: { allDecisions?: boolean } = {}): StoryBeat[] {
  const beats: Omit<StoryBeat, "n">[] = [];

  decisions.forEach((d, i) => {
    if (d.type === "advance-request") {
      const chosen = d.options?.find((o) => o.kind === d.chosen);
      const blocked = d.options?.filter((o) => o.breachesFloor) ?? [];
      const hard = blocked.length > 0 || d.chosen !== "full";
      if (!hard && !opts.allDecisions) return;
      let detail: string;
      if (blocked.length && chosen && d.chosen !== "decline") {
        const full = d.options!.find((o) => o.kind === "full");
        const moved = chosen.reallocations.reduce((s, r) => s + r.reduceBy, 0);
        detail =
          `A full ${moneyCompact(full?.amount ?? 0)} advance would leave ${moneyCompact(full?.projectedBalanceAfter ?? 0)}, under the floor. ` +
          (moved > 0 ? `Keel moved ${moneyCompact(moved)} from a softening borrower and funded it in full.` : `Keel chose to ${optionLabel[d.chosen!]!.toLowerCase()} instead.`);
      } else if (d.chosen === "decline") {
        detail = `${borrowerName(d)} asked for ${money((d.inputs.request as { amount: number }).amount)}. Declined: capacity is zero while revenue is stressed.`;
      } else {
        detail = `${borrowerName(d)}: ${optionLabel[d.chosen!]} ${chosen ? money(chosen.amount) : ""}.`;
      }
      beats.push({ week: d.week, kind: "decision", title: `${borrowerName(d)} · ${optionLabel[d.chosen ?? "decline"]}`, detail, decisionIndex: i });
    } else if (d.type === "health-review") {
      const sig = d.inputs.signals as { reasons: string[] };
      beats.push({
        week: d.week,
        kind: "stress",
        title: `${borrowerName(d)} · Stressed`,
        detail: `Revenue shock detected (${sig.reasons[0]}). New advances frozen; repayments shrink with revenue instead of forcing a default.`,
        decisionIndex: i,
      });
    }
  });

  for (const e of events) {
    if (e.level === "warn" && e.text.toLowerCase().includes("retried")) {
      beats.push({
        week: e.week,
        kind: "incident",
        title: "Lost bank response",
        detail: "The bank settled a collection but the reply never arrived. Keel retried with the same idempotency key and got the original transfer back. Nothing was collected twice.",
      });
    }
  }

  return beats.sort((a, b) => a.week - b.week || (a.kind === "decision" ? -1 : 1)).map((b, i) => ({ ...b, n: i + 1 }));
}
