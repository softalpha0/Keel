import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BankAdapter, Transfer, TransferRequest } from "../src/bank/types.js";
import { Executor } from "../src/executor.js";
import { DuplicateMovementError, FileJournal } from "../src/journal.js";
import { Ledger } from "../src/ledger.js";
import { defaultPolicy } from "../src/policy/engine.js";

/**
 * A bank that does NOT deduplicate: what Keel faces after a restart with a new run id, when the
 * bank's own request_id window can't help. Only the journal stands between Keel and a double payment.
 */
function forgetfulBank() {
  const balances = new Map<string, number>([["platform", 10_000_000], ["acct_a", 500_000]]);
  const transfers = new Map<string, Transfer>();
  let n = 0;
  const bank: BankAdapter & { moved: number } = {
    name: "forgetful",
    moved: 0,
    async getBalance(a) {
      return balances.get(a) ?? 0;
    },
    async transfer(r: TransferRequest) {
      balances.set(r.fromAccountId, (balances.get(r.fromAccountId) ?? 0) - r.amount);
      balances.set(r.toAccountId, (balances.get(r.toAccountId) ?? 0) + r.amount);
      bank.moved++;
      const t: Transfer = { id: `tr_${++n}`, status: "settled", amount: r.amount, idempotencyKey: r.idempotencyKey };
      transfers.set(t.id, t);
      return t;
    },
    async getTransfer(id) {
      return transfers.get(id)!;
    },
    async stageRevenue() {},
  };
  return bank;
}

const cfg = defaultPolicy(10_000_000, 3_000_000);
const collect = { kind: "collect" as const, borrowerId: "a", borrowerAccountId: "acct_a", amount: 100_000, idempotencyKey: "collect:adv_1:w6", reference: "t", week: 6 };
const dir = () => mkdtempSync(join(tmpdir(), "keel-journal-"));

describe("persistent journal", () => {
  it("after a restart (fresh ledger, bank that forgets), the same movement is not sent again", async () => {
    const bank = forgetfulBank();
    const d = dir();
    await new Executor(bank, new Ledger(10_000_000), cfg, "platform", 3, new FileJournal(d)).move(collect);
    // The process dies; a new one starts with an empty ledger but the same journal.
    const ledger = new Ledger(10_000_000);
    const r = await new Executor(bank, ledger, cfg, "platform", 3, new FileJournal(d)).move(collect);
    expect(bank.moved).toBe(1);
    expect(r.transferId).toBe("tr_1");
    expect(ledger.receipts).toHaveLength(1);
  });

  it("two processes racing on the same key move the money once", async () => {
    const d = dir();
    // Separate banks objects so the in-process queue can't serialise them: only the journal's lock can.
    const shared = forgetfulBank();
    const proxy = (): BankAdapter => ({ ...shared, transfer: (r) => shared.transfer(r), getTransfer: (id) => shared.getTransfer(id), getBalance: (a) => shared.getBalance(a) });
    const a = new Executor(proxy(), new Ledger(10_000_000), cfg, "platform", 3, new FileJournal(d));
    const b = new Executor(proxy(), new Ledger(10_000_000), cfg, "platform", 3, new FileJournal(d));
    const [r1, r2] = await Promise.all([a.move(collect), b.move(collect)]);
    expect(shared.moved).toBe(1);
    expect(r1.transferId).toBe(r2.transferId);
    expect(readFileSync(join(d, "journal.jsonl"), "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("refuses to record a second settled movement under the same key", () => {
    const j = new FileJournal(dir());
    const r = { kind: "collect" as const, idempotencyKey: "k", borrowerId: "a", amount: 1, transferId: "t1", status: "settled" as const, attempts: 1, week: 1 };
    j.record(r);
    expect(() => j.record({ ...r, transferId: "t2" })).toThrow(DuplicateMovementError);
  });
});
