import { AirwallexBank } from "../bank/airwallex.js";
import { fmtIn } from "../domain.js";
import { borrowerAccountsFromEnv, loadEnv } from "./env.js";

/**
 * npm run sandbox:report : request a fresh BALANCE_REPORT and compare each borrower wallet with the live balance now.
 * Airwallex builds the report from data that lags the live balance, so run this a while after a demo run
 * to see the report catch up.
 */
loadEnv();
const bank = AirwallexBank.fromEnv();
const accounts = borrowerAccountsFromEnv();
console.log("Requesting a BALANCE_REPORT from Airwallex (can take a minute)...");
const snap = await bank.balanceSnapshot();
console.log(`Report ${snap.reportId}: ${snap.rows.length} wallet lines\n`);
let all = true;
for (const [id, acct] of Object.entries(accounts)) {
  for (const line of snap.rows.filter((r) => r.accountId === acct)) {
    const live = await bank.getBalance(acct, line.currency);
    const ok = live === line.available;
    all &&= ok;
    console.log(
      `${ok ? "✓" : "…"} ${id.padEnd(9)} ${line.currency}  report ${fmtIn(line.available, line.currency).padStart(12)}  live ${fmtIn(live, line.currency).padStart(12)}` +
        (line.lastUpdate ? `  (report line updated ${line.lastUpdate})` : ""),
    );
  }
}
console.log(all ? "\nThe bank's report matches the live balance for every borrower wallet." : "\nSome lines still lag the live balance; the report is built from delayed data. Try again later.");
