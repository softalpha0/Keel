import type { DecisionRecord, Receipt } from "../../../src/ledger";

/**
 * The audit trail as one CSV: every decision Keel made and every money movement, with the bank's
 * ids. What a platform hands its auditor or regulator.
 */
export function auditCsv(args: { decisions: DecisionRecord[]; movements: (Receipt & { requestId?: string })[]; names: Record<string, string>; source: string }) {
  const cell = (v: unknown) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const dollars = (c: number) => (c / 100).toFixed(2);
  const rows: unknown[][] = [["record", "week", "borrower", "what", "amount", "currency", "status / decided by", "approval", "bank id", "request id", "memo"]];
  for (const d of args.decisions) {
    const chosen = d.options?.find((o) => o.kind === d.chosen);
    rows.push([
      "decision",
      d.week,
      args.names[d.borrowerId] ?? d.borrowerId,
      `${d.type}${d.chosen ? `: ${d.chosen}` : ""}`,
      chosen ? dollars(chosen.amount) : "",
      "USD",
      d.decidedBy,
      d.approval ? `${d.approval.required ? "required" : "not required"}, ${d.approval.approved ? "approved" : "rejected"} by ${d.approval.by}` : "",
      "",
      "",
      d.memo,
    ]);
  }
  for (const m of args.movements) {
    rows.push([
      m.kind === "disburse" ? "advance paid" : "repayment collected",
      m.week,
      args.names[m.borrowerId] ?? m.borrowerId,
      m.idempotencyKey,
      dollars(m.amount),
      "USD",
      m.status,
      "",
      m.transferId,
      m.requestId ?? "",
      m.fx ? `charged ${dollars(m.fx.localAmount)} ${m.fx.currency}, converted at ${m.fx.rate} (${m.fx.conversionId})` : "",
    ]);
  }
  return `# Keel audit trail · ${args.source}\n` + rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

export function download(filename: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
