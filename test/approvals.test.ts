import { describe, expect, it } from "vitest";
import { ApprovalDesk } from "../src/approvals/desk.js";
import { SlackApprover } from "../src/approvals/slack.js";
import type { DecisionRecord } from "../src/ledger.js";
import type { AdvanceOption } from "../src/domain.js";

const option: AdvanceOption = {
  kind: "reallocate", amount: 2_600_000, executeWeek: 5, projectedBalanceAfter: 3_000_000, breachesFloor: false, feasible: true,
  reallocations: [{ commitmentId: "cmt_1", fromBorrowerId: "kopi", reduceBy: 371_600 }],
  expectedFee: 0, expectedLoss: 0, frictionCost: 0, score: 0, rationale: [],
};
const record: DecisionRecord = { week: 5, type: "advance-request", borrowerId: "nimbus", inputs: {}, options: [option], chosen: "reallocate", decidedBy: "claude", memo: "Fund Nimbus by reallocating.", receipts: [] };

function slack(timeoutMs = 60_000) {
  const posts: { text: string; blocks?: { type: string; elements?: { url: string }[] }[] }[] = [];
  const desk = new ApprovalDesk();
  const approver = new SlackApprover("https://hooks.slack.test/x", desk, "http://localhost:8788", () => "Nimbus Apparel", timeoutMs, async (_u, b) => {
    posts.push(b as (typeof posts)[number]);
  });
  return { posts, desk, approver };
}
const links = (p: { blocks?: { type: string; elements?: { url: string }[] }[] }) => p.blocks!.find((b) => b.type === "actions")!.elements!.map((e) => new URL(e.url));

describe("approvals in Slack", () => {
  it("posts the decision with Approve / Reject links and executes only after the confirmation POST", async () => {
    const { posts, desk, approver } = slack();
    const pending = approver.approve(record, option);
    await new Promise((r) => setTimeout(r, 0));
    expect(posts[0]!.text).toContain("Reallocate capital: $26,000 to Nimbus Apparel");
    const [approve] = links(posts[0]!);

    // Opening the link (or a link preview) only shows a confirmation page.
    expect(desk.handle("GET", approve!).status).toBe(200);
    let settled = false;
    void pending.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false);

    const res = desk.handle("POST", approve!, new URLSearchParams({ token: approve!.searchParams.get("token")!, decision: "approve" }));
    expect(res.html).toContain("Approved");
    await expect(pending).resolves.toEqual({ approved: true, by: "operator via Slack" });
    expect(posts.at(-1)!.text).toContain("✅ Approved");
  });

  it("refuses a wrong token and treats silence as a rejection", async () => {
    const { posts, desk, approver } = slack(30);
    const pending = approver.approve(record, option);
    await new Promise((r) => setTimeout(r, 0));
    const [approve] = links(posts[0]!);
    expect(desk.handle("POST", approve!, new URLSearchParams({ token: "nope", decision: "approve" })).status).toBe(404);
    await expect(pending).resolves.toEqual({ approved: false, by: "timeout (no answer)" });
  });
});
