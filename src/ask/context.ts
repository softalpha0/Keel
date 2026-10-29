import { fmt as money } from "../domain.js";
import type { DecisionRecord, Ledger } from "../ledger.js";

/** What Ask Keel is told about the run on screen. Compact on purpose: it is sent with every question. */
export interface AskContext {
  source: "simulated" | "airwallex-sandbox";
  reserveFloor: number;
  weeks: { week: number; cash: number; floorHeld: boolean; reconciled: boolean }[];
  borrowers: { id: string; name: string; tier?: string; reasons?: string[]; outstanding?: number; holdbackPct?: number; currency?: string }[];
  decisions: {
    week: number;
    type: string;
    borrower: string;
    chosen?: string;
    decidedBy: string;
    approval?: string;
    options?: { kind: string; amount: number; feasible: boolean; breachesFloor: boolean; cashAfter: number; score: number }[];
    memo: string;
  }[];
  events: { week: number; level: string; text: string }[];
  /** Extra facts about the run, e.g. the end-of-run wallet check. */
  notes?: string[];
}

export function compactDecisions(decisions: DecisionRecord[], names: Record<string, string>): AskContext["decisions"] {
  return decisions.map((d) => ({
    week: d.week,
    type: d.type,
    borrower: names[d.borrowerId] ?? d.borrowerId,
    chosen: d.chosen,
    decidedBy: d.decidedBy,
    approval: d.approval?.required ? `${d.approval.approved ? "approved" : "rejected"} by ${d.approval.by}` : undefined,
    options: d.options?.map((o) => ({ kind: o.kind, amount: o.amount, feasible: o.feasible, breachesFloor: o.breachesFloor, cashAfter: o.projectedBalanceAfter, score: o.score })),
    memo: d.memo,
  }));
}

export const compactEvents = (events: Ledger["events"]) => events.map(({ week, level, text }) => ({ week, level, text }));

/** A plain answer straight from the decision log, for when Claude is not connected. */
export function offlineAnswer(question: string, ctx: AskContext): string {
  const q = question.toLowerCase();
  const weekMatch = q.match(/week\s*(\d+)|\bw(\d+)\b/);
  const week = weekMatch ? Number(weekMatch[1] ?? weekMatch[2]) : undefined;
  const borrower = ctx.borrowers.find((b) => q.includes(b.name.toLowerCase().split(" ")[0]!) || q.includes(b.id));

  if (/floor|reserve|headroom|cash/.test(q) && !borrower) {
    const tight = [...ctx.weeks].sort((a, b) => a.cash - b.cash)[0];
    const held = ctx.weeks.every((w) => w.floorHeld);
    return `The reserve floor is ${money(ctx.reserveFloor)}. ${held ? "Cash stayed at or above it every week" : "Cash fell below it at least once"}; the tightest point was week ${tight?.week} at ${money(tight?.cash ?? 0)}. Any option that would breach the floor is struck before a decision is made.`;
  }
  if (/late|receivable|settle/.test(q)) {
    const late = ctx.events.filter((e) => /not settled|catch-up/.test(e.text));
    if (late.length) return late.map((e) => `Week ${e.week}: ${e.text}`).join(" ");
  }
  if (/lost|retry|twice|duplicate|idempot/.test(q)) {
    const lost = ctx.events.find((e) => /Retried with the same key/.test(e.text));
    if (lost) return `Week ${lost.week}: ${lost.text}`;
  }
  // The kind of decision asked about beats the borrower named: "reallocate from Kopi to fund Nimbus" is Nimbus's reallocation.
  const byKind = /realloc/.test(q)
    ? ctx.decisions.filter((d) => d.chosen === "reallocate")
    : /withdr|promise|pending|top-up/.test(q)
      ? ctx.decisions.filter((d) => d.type === "commitment")
      : /stress|froze|frozen|health/.test(q)
        ? ctx.decisions.filter((d) => d.type === "health-review")
        : [];
  const pick = byKind.filter((d) => week === undefined || d.week === week);
  if (pick.length) {
    const d = pick.at(-1)!;
    return `Week ${d.week}, ${d.borrower}: ${d.memo}`;
  }
  const relevant = ctx.decisions.filter((d) => (!borrower || d.borrower === borrower.name) && (week === undefined || d.week === week));
  if (relevant.length) {
    const d = /declin|why not|refus/.test(q) ? (relevant.find((x) => x.chosen === "decline") ?? relevant.at(-1)!) : relevant.at(-1)!;
    return `Week ${d.week}, ${d.borrower}: ${d.memo}`;
  }
  if (borrower) return `${borrower.name} is ${borrower.tier ?? "not yet rated"}${borrower.reasons?.length ? ` (${borrower.reasons.join("; ")})` : ""}${borrower.outstanding !== undefined ? `, with ${money(borrower.outstanding)} outstanding` : ""}.`;
  return `This run has ${ctx.decisions.length} decisions over ${ctx.weeks.length} weeks. Ask about a borrower, a week, the reserve floor, late payments or retries.`;
}
