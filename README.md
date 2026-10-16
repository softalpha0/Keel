# Keel — Portfolio Lending Agent

Airwallex Agentic Banking Hackathon, Kit 7 (Dynamic Lending).

A revenue-based lending agent for a platform. Each borrower is a connected account. Every week the agent collects a share of each borrower's revenue, watches borrower health, and sizes new advances without ever letting platform cash drop below a reserve floor. When the full advance would breach the floor, it weighs **partial / delay / reallocate / decline** and explains its choice.

> The model reads, the code decides, the API moves the money.

## Run it

Needs Node 20+.

```bash
npm install
npm run dev         # website + console at http://localhost:5173  (console at /console)
npm test            # engine property tests + end-to-end scenario
npm run typecheck   # engine and web
npm run build       # production build of the website into dist/web
npm run preview     # serve that build at http://localhost:4173
npm run demo        # the same 10 weeks in the terminal
npm run demo:llm    # terminal run with Claude writing memos (needs ANTHROPIC_API_KEY)
```

`npm run demo -- --airwallex` runs against the Airwallex sandbox once `.env` is filled in (see `.env.example`).

## Connecting the real Airwallex sandbox

1. Sign up at [sandbox.airwallex.com](https://sandbox.airwallex.com) (name the business `New Business Sandbox` so KYB auto-approves).
   Copy the Client ID and API key from **Account > Developer > API keys** into `.env` (start from `.env.example`).
2. Kit 7 needs **connected accounts and platform payments** switched on by Airwallex: email devhelp@airwallex.com
   with your sandbox email and Client ID. You cannot enable these yourself.
3. `npm run sandbox:check` logs in and lists your Global Accounts and balances.
4. Once platform access is on: `npm run sandbox:setup` creates the three borrowers as active connected accounts,
   gives each a USD Global Account, funds the platform wallet, and prints the lines to paste into `.env`.
5. `npm run demo:sandbox` runs the same ten weeks against the real sandbox: revenue is staged with deposit
   simulations, advances go out with `connected_account_transfers`, repayments come back with `charges`.

Recommended for building: connect Airwallex's MCP servers in Claude Code
(`claude mcp add-json airwallex-docs '{ "type": "http", "url": "https://mcp.sandbox.airwallex.com/docs" }'`, and the
same for `/developer`). `CLAUDE.md` gives Claude the Kit 7 conventions.

## The website

- `/` — landing page. Every number and chart on it comes from running the real engine in the browser, not from mock data.
- `/console` — run the 10 weeks, step a week at a time, approve or reject the hard calls yourself, click any chart marker to inspect the decision, and use the What-if sliders (revenue shock size and timing, reserve floor, borrower decline) to re-run the agent live.

Code lives in `web/src`: `pages/` (Landing, Console), `components/` (hand-built SVG charts, option table, status badges), `lib/sim.ts` (bridges the engine to React), `styles/` (design tokens with light and dark themes).

## What the demo shows

| Week | Event | What the agent does |
|---|---|---|
| 3-4 | Two healthy borrowers ask for advances | Funds both in full |
| 5 | **Third advance would breach the $30k floor** | Shows all options with scores, rejects `full`, moves capital from a softening borrower's pending top-up, asks for human approval, funds in full |
| 6 | Bank loses a collection response | Retries with the same idempotency key; bank returns the original transfer; no double collection |
| 7 | Nimbus revenue drops 60% | Flags it as stressed, freezes new advances, repayments shrink with revenue |
| 8 | Nimbus asks for more | Declined, capacity is zero |
| every week | | Floor check + ledger reconciled against bank balance |

Full decision log with inputs, options, memo and transfer receipts: `out/decision-log.json`.

## Architecture

```
Observer -> Policy engine (deterministic) -> Advisor (Claude or rules) -> Guardrail -> Approver -> Executor -> Bank
                                                                                                   |
                                                                                    Ledger + reconciler
```

- `src/policy/engine.ts`: advance sizing, repayment, exposure caps, option building and scoring. Pure functions, property-tested so that no feasible option ever breaks the floor.
- `src/policy/signals.ts`: revenue trend, volatility and shock detection, mapped to `healthy / watch / stressed`.
- `src/agent/advisor.ts`: `ClaudeAdvisor` gets only the options the policy engine allows and returns structured JSON. Anything it picks outside that list is ignored. `RulesAdvisor` is the offline/fallback version.
- `src/agent/lending-agent.ts`: the weekly loop: observe, collect, review health, fund pending advances, decide on requests, reconcile.
- `src/executor.ts`: the only code that moves money. Checks the floor before any payout, uses deterministic idempotency keys, confirms each transfer by reading it back.
- `src/bank/`: the `BankAdapter` interface, `MockBank` (with fault injection) and `AirwallexBank`.

## Status

- [x] Policy engine, ledger, executor, weekly loop, mock bank, demo scenario, tests
- [x] Claude advisor using structured output and a fallback when the model is unavailable
- [x] `AirwallexBank` follows the builder guide (charges, connected account transfers, UUID request ids, NEW→SETTLED polling), tested against a fake sandbox
- [ ] First live run against the Airwallex sandbox (needs platform access)
- [x] Website: landing page + console with approvals, what-if controls, decision inspector, light/dark
- [ ] Demo video
