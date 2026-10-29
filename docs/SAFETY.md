# How Keel stays safe

An agent that moves money has to be boring in nine specific ways. Each guarantee says what is promised, how the code enforces it, and the file and test that prove it. The same list is on the site at [keel.cards/safety](https://www.keel.cards/safety).

## 1. The reserve floor is never breached

**Platform cash never drops below the floor, whatever the borrowers ask for.**

The policy engine marks any option that would leave cash under the floor as infeasible before anyone chooses. The executor then re-checks the floor against the live bank balance before every payout, and refuses if it would breach.

Code: [`src/policy/engine.ts`](../src/policy/engine.ts) · [`src/executor.ts`](../src/executor.ts)  
Tests: [`test/policy.test.ts`](../test/policy.test.ts)

## 2. Money moves exactly once

**A retry can never pay a borrower twice or charge them twice.**

Every movement has a fixed key (e.g. collect:adv_1:w6) that becomes the Airwallex request_id. A lost response is retried with the same key; an ambiguous failure is looked up by request_id before anything is resent. Currency conversions get their own key.

Code: [`src/executor.ts`](../src/executor.ts) · [`src/bank/airwallex.ts`](../src/bank/airwallex.ts)  
Tests: [`test/executor.test.ts`](../test/executor.test.ts) · [`test/airwallex.test.ts`](../test/airwallex.test.ts) · [`test/fx.test.ts`](../test/fx.test.ts)

## 3. The model can't move money or invent options

**Claude chooses and explains; it never decides what is allowed or touches the bank.**

Claude only sees options policy already marked feasible and must answer in a fixed JSON shape. A guardrail executes only a feasible option whatever the reply says, and a rules engine takes over if the model is unavailable.

Code: [`src/agent/claude-advisor.ts`](../src/agent/claude-advisor.ts) · [`src/agent/lending-agent.ts`](../src/agent/lending-agent.ts)  
Tests: [`test/scenario.test.ts`](../test/scenario.test.ts)

## 4. People approve the big calls

**Advances over $20K and every reallocation wait for a person.**

Approvals happen on the credit desk or in Slack. Slack links open a confirmation page; only a POST with a one-time token decides, so link previews can't approve. No answer in 30 minutes means no.

Code: [`src/approvals/slack.ts`](../src/approvals/slack.ts) · [`src/approvals/desk.ts`](../src/approvals/desk.ts)  
Tests: [`test/approvals.test.ts`](../test/approvals.test.ts)

## 5. Old promises are re-checked

**An advance promised weeks ago is not paid blind.**

Before a pending advance goes out, Keel re-runs the decision against today's cash and the borrower's current health, and withdraws or resizes it if it no longer fits.

Code: [`src/agent/lending-agent.ts`](../src/agent/lending-agent.ts)  
Tests: [`test/scenario.test.ts`](../test/scenario.test.ts) · [`test/collections.test.ts`](../test/collections.test.ts)

## 6. Borrowers are never overdrawn, and late money isn't distress

**Keel takes its share only of money that has arrived.**

Repayment is a share of settled sales. A charge the wallet can't cover is never sent: the gap becomes a receivable. Customer payments that settle late are collected when they land, and the borrower's health is judged on sales, not settlement timing.

Code: [`src/agent/lending-agent.ts`](../src/agent/lending-agent.ts) · [`src/ledger.ts`](../src/ledger.ts)  
Tests: [`test/collections.test.ts`](../test/collections.test.ts) · [`test/scenario.test.ts`](../test/scenario.test.ts)

## 7. The books match the bank

**Keel's ledger equals the bank, every week and in every wallet.**

Each week the ledger is checked against the platform balance. At the end, every wallet (platform and each borrower, in each currency) is checked three ways: ledger, live balance, and Airwallex's own BALANCE_REPORT, allowing for the report's lag.

Code: [`src/reconcile/portfolio.ts`](../src/reconcile/portfolio.ts)  
Tests: [`test/portfolio.test.ts`](../test/portfolio.test.ts)

## 8. Events from the bank are verified

**A forged or replayed webhook changes nothing.**

Airwallex webhooks are checked with HMAC-SHA256 over the timestamp and raw body, compared in constant time, refused if stale, and acted on once. A verified event is still read back from the API before it is booked.

Code: [`src/bank/webhooks.ts`](../src/bank/webhooks.ts)  
Tests: [`test/webhooks.test.ts`](../test/webhooks.test.ts)

## 9. Secrets stay on the server

**No API key ever reaches a browser or the repository.**

Airwallex and Anthropic keys live in .env (git-ignored) or the host's environment. Ask Keel calls Claude through a server function, and the browser only ever sees answers.

Code: [`api/ask.ts`](../api/ask.ts) · [`.gitignore`](../.gitignore)
