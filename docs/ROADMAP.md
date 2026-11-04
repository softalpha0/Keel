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

Tests for all five: `test/roadmap.test.ts` and `test/airwallex.test.ts`.

## Next

- **Live card revenue.** Read real merchant sales from Airwallex Payments Acceptance instead of simulated deposits.
- **Accounts and storage.** A database, a login per platform with roles, and an append-only audit log a regulator can read.
- **Deeper underwriting.** Customer concentration, seasonality, and backtesting the tiers on historical data before raising limits.
- **Merchant onboarding.** KYB through Airwallex, signed advance agreements, and notifications by email and in the platform's own app.
- **Compliance.** A licensing review in each market, lending disclosures, and a clear answer to who carries the credit risk: the platform or a funding partner.
- **Pilots and pricing.** Two or three platforms that already see their merchants' sales; a fee per advance or a platform subscription.
