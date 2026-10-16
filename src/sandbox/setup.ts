// npm run sandbox:setup — creates the three Kit 7 borrowers as active connected accounts,
// gives each a USD Global Account, and tops the platform wallet up to the fund size.
// Requires connected accounts AND platform payments enabled by Airwallex (devhelp@airwallex.com).
import { randomUUID } from "node:crypto";
import { AirwallexBank, AirwallexError } from "../bank/airwallex.js";
import { BORROWERS, connectedAccountBody, usdGlobalAccountBody } from "./payloads.js";
import { borrowerAccountsFromEnv, loadEnv } from "./env.js";

loadEnv();
const bank = AirwallexBank.fromEnv();
const FUND_USD = Number(process.env.KEEL_FUND_USD ?? 100_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  process.stdout.write(`  ${label} ... `);
  try {
    const v = await fn();
    console.log("ok");
    return v;
  } catch (err) {
    console.log("FAILED");
    console.error(`\n${err instanceof Error ? err.message : err}\n`);
    if (err instanceof AirwallexError && /cannot onboard business accounts/i.test(err.message)) {
      console.error("Hint: connected accounts are not enabled on this sandbox yet. Email devhelp@airwallex.com with your sandbox email and Client ID and ask for connected accounts + platform payments.");
    } else if (err instanceof AirwallexError && (err.status === 401 || err.status === 403)) {
      console.error("Hint: 403 on accounts/create usually means connected accounts or platform payments are not enabled yet. Email devhelp@airwallex.com.");
    } else {
      console.error("Hint: ask Claude Code (with the airwallex-docs MCP) to fix the payload in src/sandbox/payloads.ts using this error.");
    }
    process.exit(1);
  }
}

async function ensurePlatformFunded() {
  console.log("\nPlatform wallet");
  const balance = (await bank.getBalance(bank.platformAccountId)) / 100;
  console.log(`  USD balance ${balance}`);
  if (balance >= FUND_USD) return;
  const list = await step("find USD Global Account", () => bank.call<{ items?: { id: string }[] }>("/api/v1/global_accounts"));
  let gaId = list.items?.[0]?.id;
  if (!gaId) gaId = (await step("create USD Global Account", () => bank.call<{ id: string }>("/api/v1/global_accounts/create", { body: usdGlobalAccountBody(randomUUID()) }))).id;
  await step(`deposit USD ${FUND_USD - balance}`, () =>
    bank.call("/api/v1/simulation/deposit/create", { body: { global_account_id: gaId, amount: FUND_USD - balance, payer_name: "Keel lending fund" } }),
  );
}

async function industryCode(): Promise<string> {
  if (process.env.AIRWALLEX_INDUSTRY_CODE) return process.env.AIRWALLEX_INDUSTRY_CODE;
  const ref = await step("fetch industry categories", () => bank.call<unknown>("/api/v1/reference/industry_categories"));
  // The response shape is not documented in the guide, so search it for any ICCV3_ code.
  const codes: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string" && /^ICCV3_/.test(v)) codes.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(ref);
  if (!codes.length) {
    console.error(`\nCould not find an ICCV3_ code in the response. First 800 characters:\n${JSON.stringify(ref).slice(0, 800)}\n`);
    throw new Error("set AIRWALLEX_INDUSTRY_CODE=ICCV3_... in .env (pick one from the response above) and re-run");
  }
  console.log(`  using industry code ${codes[0]} (${codes.length} available)`);
  return codes[0]!;
}

async function createBorrower(b: (typeof BORROWERS)[number], code: string): Promise<{ acct: string; ga: string }> {
  console.log(`\n${b.name}`);
  const created = await step("create connected account", () => bank.call<{ id: string }>("/api/v1/accounts/create", { body: connectedAccountBody(b, code) }));
  const acct = created.id;
  await step("submit", () => bank.call(`/api/v1/accounts/${acct}/submit`, { body: {} }));
  await sleep(2_000);
  await step("activate (sandbox)", () => bank.call(`/api/v1/simulation/accounts/${acct}/update_status`, { body: { next_status: "ACTIVE", force: true } }));
  const acc = await step("confirm ACTIVE", () => bank.call<{ status: string }>(`/api/v1/accounts/${acct}`));
  if (acc.status !== "ACTIVE") console.warn(`  status is ${acc.status}; give it a minute and re-run sandbox:check`);
  const ga = await step("create USD Global Account", () =>
    bank.call<{ id: string }>("/api/v1/global_accounts/create", { onBehalfOf: acct, body: usdGlobalAccountBody(randomUUID()) }),
  );
  return { acct, ga: ga.id };
}

console.log("Keel sandbox setup (Kit 7)");
await ensurePlatformFunded();

const existing = borrowerAccountsFromEnv();
const code = await industryCode();
const accounts: Record<string, string> = { ...existing };
const globals: string[] = [];
for (const b of BORROWERS) {
  if (existing[b.id]) {
    console.log(`\n${b.name}: already in .env (${existing[b.id]}), skipping`);
    continue;
  }
  const { acct, ga } = await createBorrower(b, code);
  accounts[b.id] = acct;
  globals.push(`${acct}=${ga}`);
}

console.log("\nAdd these lines to .env:\n");
console.log(`AIRWALLEX_BORROWER_ACCOUNTS=${Object.entries(accounts).map(([k, v]) => `${k}=${v}`).join(",")}`);
if (globals.length) console.log(`AIRWALLEX_GLOBAL_ACCOUNTS=${globals.join(",")}`);
console.log("\nThen: npm run sandbox:check, and npm run demo:sandbox");
