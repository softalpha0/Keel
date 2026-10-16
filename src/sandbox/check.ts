// npm run sandbox:check — the builder guide's "verify" step: log in, list Global Accounts and balances.
import { AirwallexBank, AirwallexError } from "../bank/airwallex.js";
import { borrowerAccountsFromEnv, loadEnv } from "./env.js";

loadEnv();
const bank = AirwallexBank.fromEnv();

try {
  const ga = await bank.call<{ items?: { id: string; status?: string }[] }>("/api/v1/global_accounts");
  console.log(`✓ Logged in to the Airwallex sandbox`);
  console.log(`  Global Accounts on the platform: ${ga.items?.length ?? 0}`);
  const rows = await bank.call<{ currency: string; available_amount: number }[]>("/api/v1/balances/current");
  const nonzero = rows.filter((r) => r.available_amount > 0);
  console.log(`  Platform balances: ${nonzero.length ? nonzero.map((r) => `${r.currency} ${r.available_amount}`).join(", ") : "none yet"}`);

  const borrowers = borrowerAccountsFromEnv();
  if (Object.keys(borrowers).length === 0) {
    console.log(`\nNo borrower accounts in .env yet. Next: npm run sandbox:setup (needs platform access from Airwallex).`);
  } else {
    for (const [id, acct] of Object.entries(borrowers)) {
      try {
        console.log(`  ${id.padEnd(9)} ${acct}  USD ${(await bank.getBalance(acct)) / 100}`);
      } catch (err) {
        const status = err instanceof AirwallexError ? err.status : "?";
        console.log(`  ${id.padEnd(9)} ${acct}  ✗ cannot read this account (HTTP ${status}): not one of your connected accounts?`);
        process.exitCode = 1;
      }
    }
  }
} catch (err) {
  if (err instanceof AirwallexError && err.status === 401) console.error("✗ Login failed: check AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY in .env");
  else console.error("✗", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
