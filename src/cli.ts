import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { ApprovalDesk } from "./approvals/desk.js";
import { SlackApprover } from "./approvals/slack.js";
import { terminalApprover } from "./approvals/terminal.js";
import type { Approver } from "./agent/lending-agent.js";
import { WebhookHub } from "./bank/webhooks.js";
import { describeAsOf, reconcilePortfolio } from "./reconcile/portfolio.js";
import { startLocalServer } from "./server/local.js";
import { RulesAdvisor } from "./agent/advisor.js";
import { ClaudeAdvisor } from "./agent/claude-advisor.js";
import { AirwallexBank, requestId } from "./bank/airwallex.js";
import { fmt, fmtIn } from "./domain.js";
import { demoScenario } from "./sim/scenario.js";
import { borrowerAccountsFromEnv, loadEnv } from "./sandbox/env.js";
import { runScenario } from "./sim/run.js";
import { buildRunRecord, summarize, type BalanceReportRef, type RunSummary } from "./sim/record.js";

loadEnv();
const argv = process.argv.slice(2);
const args = new Set(argv);
/** --approve=slack | --approve slack | terminal | auto (default) */
const approveMode = (argv.find((a) => a.startsWith("--approve="))?.split("=")[1] ?? (args.has("--approve") ? argv[argv.indexOf("--approve") + 1] : "auto")) as string;
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
  // Multi-currency on the sandbox is opt-in: it needs an SGD Global Account (npm run sandbox:setup -- --fx).
  if (!process.env.KEEL_FX) scenario.borrowers = scenario.borrowers.map(({ currency: _c, ...b }) => b);
}

// ---------- callbacks: Airwallex webhooks and Slack approval links share one local server ----------
const port = Number(process.env.KEEL_PORT ?? 8788);
const publicUrl = (process.env.KEEL_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, "");
const hub = bank && process.env.AIRWALLEX_WEBHOOK_SECRET ? new WebhookHub(process.env.AIRWALLEX_WEBHOOK_SECRET) : undefined;
const desk = approveMode === "slack" ? new ApprovalDesk() : undefined;
let server: Server | undefined;
if (hub || desk) {
  server = await startLocalServer({ port, hub, desk });
  console.log(`Listening on ${publicUrl}${hub ? ` · Airwallex webhooks at ${publicUrl}/webhooks/airwallex` : ""}${desk ? " · Slack approval links" : ""}`);
}
if (hub && bank) bank.useWebhooks(hub);
if (bank) {
  // Deposit simulations take no request_id: remember staged deposits per run so a re-run never doubles them.
  const file = `out/staged-${bank.runId.replace(/[^\w.-]/g, "_")}.json`;
  const keys = new Set<string>(existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as string[]) : []);
  bank.stagedStore = {
    has: (k) => keys.has(k),
    add: (k) => {
      keys.add(k);
      mkdirSync("out", { recursive: true });
      writeFileSync(file, JSON.stringify([...keys]));
    },
  };
}

let approver: Approver | undefined;
if (approveMode === "terminal") approver = terminalApprover;
else if (approveMode === "slack") {
  const hook = process.env.SLACK_WEBHOOK_URL;
  if (!hook) throw new Error("--approve slack needs SLACK_WEBHOOK_URL in .env (a Slack incoming webhook)");
  const names = Object.fromEntries(scenario.borrowers.map((b) => [b.id, b.name]));
  approver = new SlackApprover(hook, desk!, publicUrl, (id) => names[id] ?? id, Number(process.env.KEEL_APPROVAL_TIMEOUT_MIN ?? 30) * 60_000);
  console.log("Approvals go to Slack; each waits up to", process.env.KEEL_APPROVAL_TIMEOUT_MIN ?? 30, "minutes, then declines.");
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

const run0 = await runScenario(scenario, {
  approver,
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
const { ledger, reports } = run0;

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

// ---------- whole-portfolio check: Keel's ledger vs the live balance API vs the bank's own report ----------
console.log("\n== Portfolio check (every wallet: Keel's ledger · live balance · bank report)");
if (bank) console.log("   Requesting Airwallex BALANCE_REPORT; it can take a minute to generate...");
const portfolio = await reconcilePortfolio({
  bank: run0.bank,
  ledger,
  borrowers: scenario.borrowers,
  staged: run0.staged,
  openingWallets: run0.openingWallets,
  platformAccountId: bank?.platformAccountId ?? "acct_platform",
  runStartedAt: startedAt,
});
for (const r of portfolio.rows) {
  const f = (c: number | undefined) => (c === undefined ? "—" : fmtIn(c, r.currency)).padStart(13);
  const note = r.report === undefined ? "" : r.reportStale ? "  (bank snapshot predates this run)" : r.reportAsOf === "now" ? "" : r.reportAsOf === undefined ? "  (matches no point in the ledger)" : `  (bank snapshot = ledger ${describeAsOf(r.reportAsOf)})`;
  console.log(`   ${r.match ? "✓" : "✗"} ${(r.label + " " + r.currency).padEnd(20)} ledger ${f(r.expected)}  live ${f(r.live)}  report ${f(r.report)}${note}`);
}
if (portfolio.reportLags) console.log("   Airwallex builds this report from data that lags the live balance; each line is checked against Keel's ledger at the time it reflects.");
if (portfolio.reportError) console.warn(`   Bank report unavailable (${portfolio.reportError}); checked against the live balance API only.`);
console.log(`   ${portfolio.allMatch ? "Every wallet matches." : "MISMATCH: see rows marked ✗."}${portfolio.reportId ? ` Report ${portfolio.reportId}.` : ""}`);
const balanceReport: BalanceReportRef | undefined = bank
  ? { requestedAt: portfolio.at, id: portfolio.reportId, status: portfolio.reportError ? undefined : "COMPLETED", error: portfolio.reportError }
  : undefined;
if (hub) console.log(`   Webhooks: ${hub.stats.accepted} accepted, ${hub.stats.rejected} rejected, ${hub.stats.duplicates} duplicates.`);

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
    portfolio,
    approvals: approveMode,
    webhooks: hub?.stats,
  });
  mkdirSync("web/public/runs", { recursive: true });
  writeFileSync("web/public/runs/latest.json", JSON.stringify(run, null, 2));
  if (useAirwallex) {
    // Every live run is also published under its own name and indexed, so the site can show the history.
    const stamp = startedAt.toISOString().slice(0, 19).replace(/:/g, "");
    writeFileSync(`web/public/runs/${stamp}.json`, JSON.stringify(run, null, 2));
    const indexFile = "web/public/runs/history.json";
    const history: RunSummary[] = existsSync(indexFile) ? (JSON.parse(readFileSync(indexFile, "utf8")) as RunSummary[]) : [];
    history.unshift(summarize(run, `${stamp}.json`));
    writeFileSync(indexFile, JSON.stringify(history.slice(0, 90), null, 2));
    console.log(`Run history updated: ${history.length} sandbox run(s).`);
    // Keep every live run as evidence, named by date, alongside the one the website shows.
    mkdirSync("evidence", { recursive: true });
    const file = `evidence/airwallex-sandbox-${startedAt.toISOString().slice(0, 19).replace(/:/g, "")}.json`;
    writeFileSync(file, JSON.stringify(run, null, 2));
    console.log(`Evidence copy written to ${file}`);
  }
  console.log("Run saved to web/public/runs/latest.json. Open /run in the website to see it.");
}
server?.close();
// The weekly invariants decide success; a wallet mismatch is reported (here, in the run file and on /run) for a person to look at.
process.exitCode = ok ? 0 : 1;
