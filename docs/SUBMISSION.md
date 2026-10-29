# HackerEarth final submission

Paste-ready text for each field. Replace the three URLs first.

**Project name:** Keel

**Track / kit:** Kit 7: Portfolio Lending Agent (Dynamic Lending)

**Tagline:** Lend against revenue. Never breach the floor.

**Links**
- Demo video: DEMO_VIDEO_URL
- Live demo: https://www.keel.cards
- Repository: https://github.com/softalpha0/Keel

---

## Short description (≈50 words)

Keel is an autonomous revenue-based lending agent for platforms on Airwallex. It collects weekly revenue-share repayments (in each borrower's own currency), tracks borrower health, and sizes, reallocates or withdraws advances so platform cash never drops below a reserve floor. Claude makes each credit call within policy, people approve the big ones in Slack, and every wallet is reconciled against Airwallex's own balance report.

## Full description

**Problem.** Platforms can lend to their merchants against revenue they already see, but the hard part is the portfolio, not any single loan. Every advance competes for the same reserve, borrower health changes week to week, customers pay late, and bank responses get lost. A credit agent has to stay solvent, never pay twice, and explain every call.

**What Keel does.** Each week Keel observes sales and settlements, collects a share of the money that actually arrived, reviews each borrower's health tier, re-checks promised advances before funding them, decides new requests, and reconciles its ledger against the bank. For each request it builds every answer (full, partial, delay, reallocate, decline), strikes anything that would breach the reserve floor, and scores the rest. When a healthy borrower's request doesn't fit, Keel reallocates a weaker borrower's unpaid promise with human approval, instead of refusing.

**Kit 7 behaviours shown.**
- Reserve floor held across 2,000 random portfolios (property test) and in every week of the demo
- Reallocation of capital from a softening borrower, with human approval
- Underpayment: late customer payments become a receivable, not a distress signal, and are caught up when they land
- A promised advance withdrawn when the borrower no longer qualifies
- Revenue shock: borrower marked stressed, credit frozen, repayments shrink with revenue
- Idempotent money movement: a lost bank response is retried with the same `request_id` and settles once
- Multi-currency: a Singapore borrower repays in SGD, converted into the fund's USD through Airwallex FX
- Approvals in Slack for large advances and every reallocation; silence means no
- Signed Airwallex webhooks confirm transfers and charges, then each is read back
- Weekly reconciliation against the bank, and at the end every wallet checked three ways: Keel's ledger, the live balance API, and Airwallex's downloaded `BALANCE_REPORT`

**Airwallex APIs used.** Connected accounts (create, submit, activate) for each borrower; Global Accounts (USD, and SGD for the multi-currency borrower); deposit simulation for customer revenue; `connected_account_transfers` for advances; `charges` with `x-on-behalf-of` for repayments; `fx/rates/current` and `fx/conversions/create`; `balances/current`; `platform_reports` (create, retrieve, CSV download of `BALANCE_REPORT`); webhooks for `connected_account_transfer.*` and `charge.*`, HMAC-verified. All money calls use deterministic `request_id`s.

**How AI is used.** "The model reads, the code decides, the API moves the money." Claude chooses among policy-feasible options only and writes the credit memo through structured output. A guardrail rejects anything else, and a deterministic rules advisor takes over if the model is unavailable. The model never calls the bank.

**Built with.** TypeScript, Node, React 19, Vite, Vitest + fast-check (40 tests), the Anthropic SDK (Claude), Slack incoming webhooks, the Airwallex sandbox API, Vercel.

## Setup instructions (for judges)

No install: open the live site and press **Launch the credit desk**. To run locally:

```bash
git clone https://github.com/softalpha0/Keel && cd Keel
npm install
npm test        # 40 tests
npm run dev     # http://localhost:5173
npm run demo    # the ten weeks in the terminal
```

The sandbox run needs Airwallex credentials and platform access; steps are in the README under "Connecting the Airwallex sandbox". The recorded run is in `evidence/` and at `/run` on the live site.

---

## Before you press submit

- [ ] Repo is **public** (Settings → General → Danger zone → Change visibility)
- [ ] Fresh `npm run demo:sandbox` done; `web/public/runs/latest.json` and the new `evidence/*.json` committed
- [ ] Vercel deploy is live; `/desk` and `/run` load when opened directly
- [ ] README: `DEMO_VIDEO_URL` and `https://www.keel.cards` replaced (search the file for both)
- [ ] Video under 5:00, unlisted or public on YouTube
- [ ] CI badge is green on `main`
- [ ] `.env` is **not** in the repo (`git ls-files | grep .env` shows only `.env.example`)
