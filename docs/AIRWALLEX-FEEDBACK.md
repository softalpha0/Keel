# Building Kit 7 on the Airwallex sandbox: what we hit, and what Keel does about it

Shared with the Airwallex team on the hackathon channel. Each item says what we observed, then how Keel handles it today, so nothing depends on an answer arriving.

| # | What we observed | How Keel handles it |
| --- | --- | --- |
| 1 | Connected account **submit** needs `description_of_goods_or_services`, `operating_country`, `account_usage.product_reference` and `identifications.primary`. They aren't in the builder guide, and each error names only the next missing field. | `src/sandbox/payloads.ts` sends all four up front, so `npm run sandbox:setup` succeeds first time. |
| 2 | `cannot onboard business accounts` until platform access is enabled by email to devhelp. Nothing in the dashboard says so. | `sandbox:setup` recognises the error and prints what to ask for. The README explains it under "Connecting the Airwallex sandbox". |
| 3 | A failed onboarding attempt leaves a connected account stuck at "KYC not submitted", and we found no way to remove it. | Harmless to Keel: it only uses the accounts listed in `AIRWALLEX_BORROWER_ACCOUNTS`. |
| 4 | `simulation/deposit/create` takes no `request_id`, so a retry can deposit twice. | Every staged deposit is recorded per run in `out/staged-<run>.json` before moving on. Re-running the same `AIRWALLEX_RUN_ID` after a crash never deposits the same week twice. |
| 5 | It isn't documented whether the `charges` / `connected_account_transfers` list endpoints filter by `request_id`. | After an ambiguous failure Keel looks the transfer up by `request_id`, filtering client-side across up to five pages, before it ever retries. Settles once either way. |
| 6 | `fx/rates/current` returns `rate` for a currency pair whose direction depends on the pair's convention. | Keel quotes a fixed `sell_amount` and derives the rate from `buy_amount / sell_amount`, so the direction can't be misread. |
| 7 | The BALANCE_REPORT download link lives for one minute. | Keel downloads it in the same call that sees `COMPLETED`, then reconciles every wallet against it. |

Questions still open with Airwallex: items 3, 4 (is a `request_id` planned?) and 5.
