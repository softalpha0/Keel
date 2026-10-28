import { fmt } from "../domain.js";
import type { AdvanceOption } from "../domain.js";
import type { Approver } from "../agent/lending-agent.js";
import type { DecisionRecord } from "../ledger.js";
import type { ApprovalDesk } from "./desk.js";

const LABEL: Record<AdvanceOption["kind"], string> = {
  full: "Fund in full",
  partial: "Fund partially",
  delay: "Delay",
  reallocate: "Reallocate capital",
  decline: "Decline",
};

/**
 * Sends each decision that needs a person to a Slack channel (incoming webhook) with
 * Approve / Reject buttons, and waits for the answer. No answer in time means reject.
 */
export class SlackApprover implements Approver {
  constructor(
    private webhookUrl: string,
    private desk: ApprovalDesk,
    private baseUrl: string,
    private borrowerName: (id: string) => string,
    private timeoutMs = 30 * 60_000,
    private post: (url: string, body: unknown) => Promise<void> = postJson,
  ) {}

  async approve(record: DecisionRecord, option: AdvanceOption) {
    const id = `${record.week}-${record.borrowerId}-${option.kind}-${Date.now().toString(36)}`;
    const name = this.borrowerName(record.borrowerId);
    const title = `${LABEL[option.kind]}: ${fmt(option.amount)} to ${name}`;
    const why = option.reallocations.length
      ? `Moves ${fmt(option.reallocations.reduce((s, r) => s + r.reduceBy, 0))} from another borrower's unpaid promise.`
      : `Above the approval line.`;
    const { token, result } = this.desk.open({ id, title, detail: record.memo }, this.timeoutMs, () =>
      void this.post(this.webhookUrl, { text: `⏱ ${title}: no answer in ${this.timeoutMs / 60_000} min, declined automatically.` }).catch(() => {}),
    );
    const link = (decision: string) => `${this.baseUrl}/approve/${encodeURIComponent(id)}?token=${token}&decision=${decision}`;

    const rows = (record.options ?? [])
      .map((o) => `${o.kind === option.kind ? "▶" : o.feasible ? "•" : "✗"} ${LABEL[o.kind]} ${fmt(o.amount)} · cash after ${fmt(o.projectedBalanceAfter)}${o.breachesFloor ? " (breaches floor)" : ""}`)
      .join("\n");
    await this.post(this.webhookUrl, {
      text: `Approval needed · week ${record.week}: ${title}`,
      blocks: [
        { type: "header", text: { type: "plain_text", text: `Approval needed · week ${record.week}` } },
        { type: "section", text: { type: "mrkdwn", text: `*${title}*\n${why}` } },
        { type: "section", text: { type: "mrkdwn", text: "```" + rows + "```" } },
        { type: "context", elements: [{ type: "mrkdwn", text: `Credit memo (${record.decidedBy === "claude" ? "Claude" : "policy rules"}): ${record.memo}`.slice(0, 2900) }] },
        {
          type: "actions",
          elements: [
            { type: "button", style: "primary", text: { type: "plain_text", text: "Approve" }, url: link("approve") },
            { type: "button", style: "danger", text: { type: "plain_text", text: "Reject" }, url: link("reject") },
          ],
        },
      ],
    });

    const outcome = await result;
    if (outcome.by !== "timeout") {
      await this.post(this.webhookUrl, { text: `${outcome.approved ? "✅ Approved" : "🛑 Rejected"} in Slack: ${title}` }).catch(() => {});
    }
    return { approved: outcome.approved, by: outcome.by === "timeout" ? "timeout (no answer)" : "operator via Slack" };
  }
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Slack webhook ${res.status}: ${await res.text()}`);
}
