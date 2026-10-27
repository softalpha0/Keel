# HackerEarth final submission

Paste-ready text for each field. Replace the three URLs first.

**Project name:** Keel

**Track / kit:** Kit 7: Portfolio Lending Agent (Dynamic Lending)

**Tagline:** Lend against revenue. Never breach the floor.

**Links**
- Demo video: DEMO_VIDEO_URL
- Live demo: LIVE_SITE_URL
- Repository: https://github.com/softalpha0/Keel

---

## Short description (≈50 words)

Keel is an autonomous revenue-based lending agent for platforms on Airwallex. It collects weekly revenue-share repayments, tracks borrower health, and sizes, reallocates or withdraws advances so platform cash never drops below a reserve floor. Every decision carries its options and a memo, and every transfer runs once, verified on the Airwallex sandbox.

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
- Weekly reconciliation against the bank, plus an Airwallex `BALANCE_REPORT`

**Airwallex APIs used.** Connected accounts (create, submit, activate) for each borrower; Global Accounts; deposit simulation for customer revenue; `connected_account_transfers` for advances; `charges` with `x-on-behalf-of` for repayments; `balances/current`; `platform_reports` (`BALANCE_REPORT`). All money calls use deterministic `request_id`s and are polled to `SETTLED`.

**How AI is used.** "The model reads, the code decides, the API moves the money." Claude chooses among policy-feasible options only and writes the credit memo through structured output. A guardrail rejects anything else, and a deterministic rules advisor takes over if the model is unavailable. The model never calls the bank.

**Built with.** TypeScript, Node, React 19, Vite, Vitest, fast-check, the Anthropic SDK, the Airwallex sandbox API, Vercel.

## Setup instructions (for judges)

No install: open the live site and press **Run the ten weeks**. To run locally:

```bash
git clone https://github.com/softalpha0/Keel && cd Keel
npm install
npm test        # 23 tests
npm run dev     # http://localhost:5173
npm run demo    # the ten weeks in the terminal
```

The sandbox run needs Airwallex credentials and platform access; steps are in the README under "Connecting the Airwallex sandbox". The recorded run is in `evidence/` and at `/run` on the live site.

---

## Before you press submit

- [ ] Repo is **public** (Settings → General → Danger zone → Change visibility)
- [ ] Fresh `npm run demo:sandbox` done; `web/public/runs/latest.json` and the new `evidence/*.json` committed
- [ ] Vercel deploy is live; `/console` and `/run` load when opened directly
- [ ] README: `DEMO_VIDEO_URL` and `LIVE_SITE_URL` replaced (search the file for both)
- [ ] Video under 5:00, unlisted or public on YouTube
- [ ] CI badge is green on `main`
- [ ] `.env` is **not** in the repo (`git ls-files | grep .env` shows only `.env.example`)
