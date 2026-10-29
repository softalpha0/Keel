import { Link } from "react-router-dom";
import { ThemeToggle, Wordmark } from "../components/Brand";
import { Check } from "../components/Status";

const REPO = "https://github.com/softalpha0/Keel/blob/main/";

interface Guarantee {
  title: string;
  claim: string;
  how: string;
  code: string[];
  tests: string[];
}

/** One page for judges who skim: each guarantee, how it is enforced, and where to check. */
export const GUARANTEES: Guarantee[] = [
  {
    title: "The reserve floor is never breached",
    claim: "Platform cash never drops below the floor, whatever the borrowers ask for.",
    how: "The policy engine marks any option that would leave cash under the floor as infeasible before anyone chooses. The executor then re-checks the floor against the live bank balance before every payout, and refuses if it would breach.",
    code: ["src/policy/engine.ts", "src/executor.ts"],
    tests: ["test/policy.test.ts"],
  },
  {
    title: "Money moves exactly once",
    claim: "A retry can never pay a borrower twice or charge them twice.",
    how: "Every movement has a fixed key (e.g. collect:adv_1:w6) that becomes the Airwallex request_id. A lost response is retried with the same key; an ambiguous failure is looked up by request_id before anything is resent. Currency conversions get their own key.",
    code: ["src/executor.ts", "src/bank/airwallex.ts"],
    tests: ["test/executor.test.ts", "test/airwallex.test.ts", "test/fx.test.ts"],
  },
  {
    title: "The model can't move money or invent options",
    claim: "Claude chooses and explains; it never decides what is allowed or touches the bank.",
    how: "Claude only sees options policy already marked feasible and must answer in a fixed JSON shape. A guardrail executes only a feasible option whatever the reply says, and a rules engine takes over if the model is unavailable.",
    code: ["src/agent/claude-advisor.ts", "src/agent/lending-agent.ts"],
    tests: ["test/scenario.test.ts"],
  },
  {
    title: "People approve the big calls",
    claim: "Advances over $20K and every reallocation wait for a person.",
    how: "Approvals happen on the credit desk or in Slack. Slack links open a confirmation page; only a POST with a one-time token decides, so link previews can't approve. No answer in 30 minutes means no.",
    code: ["src/approvals/slack.ts", "src/approvals/desk.ts"],
    tests: ["test/approvals.test.ts"],
  },
  {
    title: "Old promises are re-checked",
    claim: "An advance promised weeks ago is not paid blind.",
    how: "Before a pending advance goes out, Keel re-runs the decision against today's cash and the borrower's current health, and withdraws or resizes it if it no longer fits.",
    code: ["src/agent/lending-agent.ts"],
    tests: ["test/scenario.test.ts", "test/collections.test.ts"],
  },
  {
    title: "Borrowers are never overdrawn, and late money isn't distress",
    claim: "Keel takes its share only of money that has arrived.",
    how: "Repayment is a share of settled sales. A charge the wallet can't cover is never sent: the gap becomes a receivable. Customer payments that settle late are collected when they land, and the borrower's health is judged on sales, not settlement timing.",
    code: ["src/agent/lending-agent.ts", "src/ledger.ts"],
    tests: ["test/collections.test.ts", "test/scenario.test.ts"],
  },
  {
    title: "The books match the bank",
    claim: "Keel's ledger equals the bank, every week and in every wallet.",
    how: "Each week the ledger is checked against the platform balance. At the end, every wallet (platform and each borrower, in each currency) is checked three ways: ledger, live balance, and Airwallex's own BALANCE_REPORT, allowing for the report's lag.",
    code: ["src/reconcile/portfolio.ts"],
    tests: ["test/portfolio.test.ts"],
  },
  {
    title: "Events from the bank are verified",
    claim: "A forged or replayed webhook changes nothing.",
    how: "Airwallex webhooks are checked with HMAC-SHA256 over the timestamp and raw body, compared in constant time, refused if stale, and acted on once. A verified event is still read back from the API before it is booked.",
    code: ["src/bank/webhooks.ts"],
    tests: ["test/webhooks.test.ts"],
  },
  {
    title: "Secrets stay on the server",
    claim: "No API key ever reaches a browser or the repository.",
    how: "Airwallex and Anthropic keys live in .env (git-ignored) or the host's environment. Ask Keel calls Claude through a server function, and the browser only ever sees answers.",
    code: ["api/ask.ts", ".gitignore"],
    tests: [],
  },
];

export function SafetyPage() {
  return (
    <div className="console">
      <header className="topbar">
        <div className="topbar-inner">
          <Wordmark />
          <span className="topbar-sep" aria-hidden="true" />
          <div className="topbar-title">
            <strong>Safety</strong>
            <span className="muted">What Keel guarantees, and where to check</span>
          </div>
          <div className="topbar-actions">
            <ThemeToggle />
            <Link to="/desk" className="btn btn-ghost btn-sm">
              Credit desk
            </Link>
            <Link to="/" className="btn btn-ghost btn-sm">
              Overview
            </Link>
          </div>
        </div>
      </header>
      <main className="page-main safety">
        <section className="safety-head">
          <p className="eyebrow">How Keel stays safe</p>
          <h1 className="h2">An agent that moves money has to be boring in nine specific ways.</h1>
          <p className="section-lede">Each guarantee below says what is promised, how the code enforces it, and the file and test that prove it.</p>
          <dl className="safety-stats">
            <div>
              <dt>Random portfolios tested</dt>
              <dd>2,000</dd>
            </div>
            <div>
              <dt>Automated tests</dt>
              <dd>40+</dd>
            </div>
            <div>
              <dt>Floor breaches</dt>
              <dd>0</dd>
            </div>
            <div>
              <dt>Ways every wallet is checked</dt>
              <dd>3</dd>
            </div>
          </dl>
        </section>
        <ol className="safety-list">
          {GUARANTEES.map((g, i) => (
            <li key={g.title} className="card safety-item">
              <div className="safety-n num">{String(i + 1).padStart(2, "0")}</div>
              <div className="safety-copy">
                <h2>
                  <Check size={14} /> {g.title}
                </h2>
                <p className="safety-claim">{g.claim}</p>
                <p className="secondary">{g.how}</p>
                <div className="safety-links">
                  {g.code.map((f) => (
                    <a key={f} href={REPO + f} target="_blank" rel="noreferrer" className="pill">
                      {f}
                    </a>
                  ))}
                  {g.tests.map((f) => (
                    <a key={f} href={REPO + f} target="_blank" rel="noreferrer" className="pill pill-good">
                      {f}
                    </a>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
