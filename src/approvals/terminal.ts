import { createInterface } from "node:readline/promises";
import { fmt, type AdvanceOption } from "../domain.js";
import type { Approver } from "../agent/lending-agent.js";
import type { DecisionRecord } from "../ledger.js";

/** Asks in the terminal. Anything but "y" rejects. */
export const terminalApprover: Approver = {
  async approve(record: DecisionRecord, option: AdvanceOption) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log(`\n  APPROVAL NEEDED · week ${record.week} · ${option.kind} ${fmt(option.amount)} to ${record.borrowerId}\n  ${record.memo}`);
    const answer = (await rl.question("  Approve and execute? [y/N] ")).trim().toLowerCase();
    rl.close();
    return { approved: answer === "y" || answer === "yes", by: "operator in terminal" };
  },
};
