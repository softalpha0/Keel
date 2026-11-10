// npm run sandbox:payments — can customers pay a merchant by card, with the money reaching the
// merchant's wallet? Follows Airwallex's "collect payments directly" model:
//   1. the platform creates a PaymentIntent with the merchant as connected_account_id (no x-on-behalf-of)
//   2. confirms it with the sandbox test card (and captures it if needed)
//   3. creates a FundsSplit from that payment to the merchant's connected account
//   4. watches the merchant's USD balance to see when the money lands
// Prints ids, statuses and error codes only, never keys.
import { randomUUID } from "node:crypto";
import { AirwallexBank, AirwallexError } from "../bank/airwallex.js";
import { borrowerAccountsFromEnv, loadEnv } from "./env.js";

loadEnv();
const bank = AirwallexBank.fromEnv();
const AMOUNT = 25;
const SPLIT = 22.5; // what the merchant receives; the rest stays with the platform as its cut

type Intent = { id: string; status?: string; captured_amount?: number };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (err: unknown) =>
  err instanceof AirwallexError ? `HTTP ${err.status} ${err.code ?? ""} ${err.message.replace(/^.*?-> \d+ /, "").slice(0, 260)}` : err instanceof Error ? err.message : String(err);

async function usd(acct: string) {
  return (await bank.getBalance(acct, "USD")) / 100;
}

async function tryMerchant(name: string, acct: string) {
  console.log(`\n${name} (${acct})`);
  const before = await usd(acct);
  let pi: Intent;
  try {
    const create = (withAccount: boolean) =>
      bank.call<Intent>("/api/v1/pa/payment_intents/create", {
        body: { request_id: randomUUID(), merchant_order_id: `keel-${name}-${Date.now()}`, amount: AMOUNT, currency: "USD", ...(withAccount && { connected_account_id: acct }) },
      });
    try {
      pi = await create(true);
      console.log(`  ✓ payment intent ${pi.id} (with connected_account_id)`);
    } catch (err) {
      // The merchant isn't enabled for payment acceptance yet: try a plain platform payment, split afterwards.
      console.log(`  · with connected_account_id: ${errText(err)}`);
      pi = await create(false);
      console.log(`  ✓ payment intent ${pi.id} (platform only, split to the merchant afterwards)`);
    }
    pi = await bank.call<Intent>(`/api/v1/pa/payment_intents/${pi.id}/confirm`, {
      body: { request_id: randomUUID(), payment_method: { type: "card", card: { number: "4111111111111111", expiry_month: "12", expiry_year: "2030", cvc: "123", name: "Keel Test" } } },
    });
    console.log(`  ✓ confirmed → ${pi.status}`);
    if (pi.status === "REQUIRES_CAPTURE") {
      pi = await bank.call<Intent>(`/api/v1/pa/payment_intents/${pi.id}/capture`, { body: { request_id: randomUUID(), amount: AMOUNT } });
      console.log(`  ✓ captured → ${pi.status}`);
    }
  } catch (err) {
    console.log(`  ✗ payment: ${errText(err)}`);
    return false;
  }
  try {
    const split = await bank.call<{ id: string; status?: string }>("/api/v1/pa/funds_splits/create", {
      body: { request_id: randomUUID(), source_id: pi.id, source_type: "PAYMENT_INTENT", amount: SPLIT, destination: acct, metadata: { reason: "keel card revenue check" } },
    });
    console.log(`  ✓ funds split ${split.id} → ${split.status ?? "created"} (USD ${SPLIT} to the merchant)`);
  } catch (err) {
    console.log(`  ✗ funds split: ${errText(err)}`);
    return false;
  }
  // How long until the merchant can spend it? Keel collects from this wallet, so this timing matters.
  for (let s = 0; s <= 60; s += 10) {
    const now = await usd(acct);
    if (now >= before + SPLIT - 0.01) {
      console.log(`  ✓ merchant wallet USD ${before} → ${now} after ~${s}s`);
      return true;
    }
    if (s < 60) await sleep(10_000);
  }
  console.log(`  … merchant wallet still USD ${await usd(acct)} after 60s (split pending settlement)`);
  return true;
}

console.log(`Card payments to merchants, "collect directly" model (USD ${AMOUNT} each, test card 4111…1111)`);
const results: boolean[] = [];
for (const [name, acct] of Object.entries(borrowerAccountsFromEnv())) results.push(await tryMerchant(name, acct));
console.log(results.every(Boolean) ? "\nDone. Send this output to Claude." : "\nSomething failed above. Send this output to Claude.");
