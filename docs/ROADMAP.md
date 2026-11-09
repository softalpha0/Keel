# Roadmap

What Keel can show today, and what a platform would need before lending real money. The same list is on the site at [keel.cards/#roadmap](https://www.keel.cards/#roadmap).

## Shipped in this build

| # | What | Where to see it | Code |
|---|---|---|---|
| 1 | **Revenue checked against the bank.** Each week Keel lists the deposits Airwallex recorded in every borrower's connected account (`GET /api/v1/deposits`, on behalf of the account) and compares them with the platform's sales feed. If the bank shows less, Keel collects only on the bank's figure. On the sandbox the check reports by default; `KEEL_VERIFY_DEPOSITS=enforce` makes it gate collections. | `/run` (grid of checks), `/desk` (badge per borrower), what-if "a customer payment bounces" | `src/bank/airwallex.ts` `listDeposits`, `src/agent/lending-agent.ts` `verifyDeposits`, `src/sim/run.ts` |
| 2 | **Audit trail export.** Every decision and money movement with the bank's ids, as one CSV, plus the raw run file. Platform settings are saved in the browser, a stand-in for stored portfolios. | `/run` and `/desk`: "Download audit trail (CSV)" | `web/src/lib/audit.ts`, `web/src/lib/workspace.ts` |
| 3 | **Refunds and chargebacks in underwriting.** Health tiers now read the refund rate: watch at 6% of sales, stressed at 12%. | `/borrowers/:id`, what-if "Nimbus refunds after the shock" | `src/policy/signals.ts` |
| 4 | **Platform rules.** Approval line, limit per borrower and advance size, set on the desk and saved; the sandbox run reads `KEEL_APPROVAL_LINE`, `KEEL_MAX_EXPOSURE_PCT`, `KEEL_ADVANCE_WEEKS`. Each run file records the rules it used. | `/desk` "Platform rules", `/run` header | `src/sim/scenario.ts`, `src/cli.ts` |
| 5 | **Merchant requests and notifications.** Merchants request funds from the portal; Keel decides the request in that week's run, and it shows on the credit desk too. Payouts, repayments and decisions appear as notifications. | `/portal/:id` | `web/src/pages/PortalPage.tsx` |

| 6 | **Backtest over merchant history.** Keel's policy replayed over 300 synthetic merchants and two years of weekly sales (steady, growing, seasonal, declining, demand shock, closure, refund spiral), against a lender with the same sizing rule but no health checks. Keel: 4.8% of principal lost and +2.8% net; without health checks: 30.8% lost and −25.2%. Keel still loses about half of what it lent to merchants that close suddenly, which no revenue signal can see coming. | `/backtest` | `src/backtest/`, `test/backtest.test.ts` |
| 7 | **Persistent journal.** Settled movements are appended to a durable journal (one JSON line per movement) and each idempotency key is claimed with an exclusive lock file before the bank is called. A restart with an empty ledger, a second process, or a re-run of the same sandbox run id can't move the same money twice. In production this becomes a database table with a unique index on the key. | `out/journal/<run id>/` after a sandbox run | `src/journal.ts`, `test/journal.test.ts` |

Tests: `test/roadmap.test.ts`, `test/backtest.test.ts`, `test/journal.test.ts` and `test/airwallex.test.ts`. Items 6 and 7 answer feedback from Cyrus at Airwallex, who asked for persistent transaction records and for the policy to be tested against merchant history.

## Next

- **Live card revenue.** Read real merchant sales from Airwallex Payments Acceptance instead of simulated deposits.
- **Accounts and storage.** Move the journal into a database with a unique key, a login per platform with roles, and an append-only audit log a regulator can read.
- **Deeper underwriting.** Customer concentration and seasonality in the tiers, and the backtest run on a platform's real sales history before raising limits.
- **Merchant onboarding.** KYB through Airwallex, signed advance agreements, and notifications by email and in the platform's own app.
- **Compliance.** A licensing review in each market, lending disclosures, and a clear answer to who carries the credit risk: the platform or a funding partner.
- **Pilots and pricing.** Two or three platforms that already see their merchants' sales; a fee per advance or a platform subscription.
