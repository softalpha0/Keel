import { mkdirSync, writeFileSync } from "node:fs";
import { RulesAdvisor } from "./agent/advisor.js";
import { ClaudeAdvisor } from "./agent/claude-advisor.js";
import { AirwallexBank, requestId } from "./bank/airwallex.js";
import { fmt } from "./domain.js";
import { demoScenario } from "./sim/scenario.js";
import { borrowerAccountsFromEnv, loadEnv } from "./sandbox/env.js";
import { runScenario } from "./sim/run.js";
import { buildRunRecord, type BalanceReportRef } from "./sim/record.js";

loadEnv();
const args = new Set(process.argv.slice(2));
const useLlm = args.has("--llm");
const useAirwallex = args.has("--airwallex");
// --record saves a simulated run for the website too (handy for previewing the Sandbox run page).
const record = useAirwallex || args.has("--record");
const startedAt = new Date();

if (useLlm && !process.env.ANTHROPIC_API_KEY) console.warn("--llm set but ANTHROPIC_API_KEY is empty; memos will fall back to rules.\n");

const scenario = demoScenario();
const bank = useAirwallex ? AirwallexBank.fromEnv() : undefined;
if (useAirwallex) {
  // Point each simulated borrower at its real sandbox connected account.
  const accounts = borrowerAccountsFromEnv();
  scenario.borrowers = scenario.borrowers.map((b) => {
    const acct = accounts[b.id];
    if (!acct) throw new Error(`no connected account for ${b.id} in AIRWALLEX_BORROWER_ACCOUNTS; run npm run sandbox:setup`);
    return { ...b, accountId: acct };
  });
  scenario.lostResponseWeeks = [];
}
let printed = 0;

// A sandbox wallet holds millions, so a $30K floor would never bind. Ring-fence the fund instead:
// Keel may lend only `fundSize` out of the wallet, and the floor is measured inside that fund.
let policy: { reserveFloor: number } | undefined;
if (bank) {
  const opening = await bank.getBalance(bank.platformAccountId);
  if (opening < scenario.fundSize) throw new Error(`platform USD balance ${fmt(opening)} is below the ${fmt(scenario.fundSize)} fund`);
  policy = { reserveFloor: opening - scenario.fundSize + scenario.reserveFloor };
  console.log(`Platform wallet ${fmt(opening)}. Lending fund ring-fenced at ${fmt(scenario.fundSize)}; cash may not drop below ${fmt(policy.reserveFloor)}.`);
}

const { ledger, reports } = await runScenario(scenario, {
  advisor: useLlm ? new ClaudeAdvisor() : new RulesAdvisor(),
  bank,
  policy,
  platformAccountId: bank?.platformAccountId,
  onWeek: (r, agent) => {
    const tiers = [...agent.borrowers.values()]
      .map((b) => `${b.id}:${agent.ledger.signals.get(b.id)?.tier ?? "-"}`)
      .join(" ");
    console.log(
      `\n== Week ${r.week}  cash ${fmt(r.platformBalance)}  floor ${fmt(agent.cfg.reserveFloor)} ${r.floorHeld ? "OK" : "BREACH"}  ledger ${r.reconciled ? "reconciled" : "MISMATCH"}  [${tiers}]`,
    );
    for (const e of agent.ledger.events.slice(printed)) console.log(`   ${e.level === "warn" ? "!" : "-"} ${e.text}`);
    printed = agent.ledger.events.length;
  },
});

console.log("\n== Decisions");
for (const d of ledger.decisions) {
  console.log(`\n[week ${d.week}] ${d.type} ${d.borrowerId} -> ${d.chosen ?? "review"} (${d.decidedBy}${d.approval?.required ? `, approved by ${d.approval.by}` : ""})`);
  for (const o of d.options ?? []) {
    console.log(`   ${o.feasible ? " " : "x"} ${o.kind.padEnd(10)} ${fmt(o.amount).padStart(8)}  wk${o.executeWeek}  score ${fmt(o.score).padStart(7)}  cash after ${fmt(o.projectedBalanceAfter)}${o.breachesFloor ? "  BREACHES FLOOR" : ""}`);
  }
  console.log(`   memo: ${d.memo}`);
}

console.log("\n== Book");
for (const a of ledger.advances) {
  console.log(`   ${a.id} ${a.borrowerId.padEnd(9)} principal ${fmt(a.principal).padStart(8)}  fee ${fmt(a.fee).padStart(6)}  outstanding ${fmt(a.outstanding).padStart(8)}  (week ${a.disbursedWeek})`);
}
const ok = reports.every((r) => r.floorHeld && r.reconciled);
console.log(`\nFloor held every week and ledger reconciled every week: ${ok ? "YES" : "NO"}`);

mkdirSync("out", { recursive: true });
writeFileSync("out/decision-log.json", JSON.stringify({ decisions: ledger.decisions, receipts: ledger.receipts, events: ledger.events }, null, 2));
console.log("Decision log written to out/decision-log.json");

let balanceReport: BalanceReportRef | undefined;
if (bank) {
  // Ask Airwallex for its own snapshot of every wallet, so the book can be checked against the bank's report too.
  balanceReport = { requestedAt: new Date().toISOString() };
  try {
    Object.assign(balanceReport, await bank.createBalanceReport());
    console.log(`Airwallex BALANCE_REPORT requested: ${balanceReport.id ?? "(no id returned)"} ${balanceReport.status ?? ""}`);
  } catch (err) {
    balanceReport.error = err instanceof Error ? err.message.slice(0, 300) : String(err);
    console.warn(`BALANCE_REPORT request failed (the run itself is unaffected): ${balanceReport.error}`);
  }
}

if (record) {
  const run = buildRunRecord({
    source: useAirwallex ? "airwallex-sandbox" : "simulated",
    runId: bank?.runId ?? startedAt.toISOString(),
    startedAt,
    fundSize: scenario.fundSize,
    reserveFloor: policy?.reserveFloor ?? scenario.reserveFloor,
    borrowers: scenario.borrowers,
    ledger,
    reports,
    requestIdFor: bank ? (key) => requestId(bank.runId, key) : undefined,
    balanceReport,
  });
  mkdirSync("web/public/runs", { recursive: true });
  writeFileSync("web/public/runs/latest.json", JSON.stringify(run, null, 2));
  if (useAirwallex) {
    // Keep every live run as evidence, named by date, alongside the one the website shows.
    mkdirSync("evidence", { recursive: true });
    const file = `evidence/airwallex-sandbox-${startedAt.toISOString().slice(0, 19).replace(/:/g, "")}.json`;
    writeFileSync(file, JSON.stringify(run, null, 2));
    console.log(`Evidence copy written to ${file}`);
  }
  console.log("Run saved to web/public/runs/latest.json. Open /run in the website to see it.");
}
process.exitCode = ok ? 0 : 1;
