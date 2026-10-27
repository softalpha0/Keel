# Evidence

Recorded runs of Keel against the **Airwallex sandbox**. Each file is written by `npm run demo:sandbox` and named by its start time (UTC).

Every id in these files was returned by Airwallex. Search any of them in the sandbox dashboard.

| Field | What it is |
| --- | --- |
| `runId` | Namespaces every `request_id` in the run, so re-running never collides inside the 7-day dedupe window |
| `borrowers[].accountId` | The borrower's Airwallex connected account (`acct_…`) |
| `movements[]` | Every advance (`connected_account_transfers`) and repayment (`charges`), with `transferId` (Airwallex id), `requestId`, amount in cents, status and attempt count |
| `receivables[]` | Repayments that were due but not collectable yet, and the week they cleared |
| `decisions[]` | Every decision with all options considered, the one chosen, who decided, approvals and the memo |
| `weeks[]` | End-of-week platform balance from Airwallex, the ledger's expected balance, and whether they matched |
| `balanceReport` | The `BALANCE_REPORT` requested from `platform_reports` at the end of the run |
| `floorHeldEveryWeek`, `reconciledEveryWeek` | The two invariants, checked against the bank |

Amounts are in **cents** (Keel's internal unit). Airwallex calls use major units, converted at the adapter boundary.

The platform wallet in the sandbox holds far more than the fund, so the run ring-fences $100,000 of it: `fund.reserveFloor` is the absolute balance that may not be crossed (opening balance − fund size + $30,000).

No secrets are stored here: only ids, amounts and decisions.
