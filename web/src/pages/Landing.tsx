import { Link } from "react-router-dom";
import { CashChart } from "../components/CashChart";
import { OptionBars } from "../components/OptionBars";
import { Sparkline } from "../components/Sparkline";
import { TierBadge } from "../components/Status";
import { ThemeToggle, Wordmark } from "../components/Brand";
import { borrowerSector, money, moneyCompact, optionLabel, pct } from "../lib/format";
import { useReveal } from "../lib/hooks";
import { runDate, useLatestRun, type LatestRun } from "../lib/run";
import { useDemoRun, type RunResult } from "../lib/sim";
import { storyBeats } from "../lib/story";

export function Landing() {
  const run = useDemoRun();
  const live = useLatestRun();
  return (
    <div className="landing">
      <Nav />
      <main>
        <Hero run={run} live={live} />
        <Pipeline run={run} />
        <HardCase run={run} />
        <LateMoney run={run} />
        <Portfolio run={run} />
        <Guarantees run={run} />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header className="nav">
      <div className="container nav-inner">
        <Wordmark />
        <nav className="nav-links" aria-label="Sections">
          <a href="#how">How it decides</a>
          <a href="#hard-case">The hard case</a>
          <a href="#late-money">Late money</a>
          <a href="#guarantees">Guarantees</a>
          <Link to="/run">Live run</Link>
        </nav>
        <div className="nav-actions">
          <ThemeToggle />
          <Link to="/console" className="btn btn-primary btn-sm">
            Open console <span className="arrow">→</span>
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero({ run, live }: { run: RunResult | null; live: LatestRun }) {
  const beats = run ? storyBeats(run.decisions, run.events) : [];
  const deployed = run?.advances.reduce((s, a) => s + a.principal, 0) ?? 0;
  const minHeadroom = run ? Math.min(...run.snaps.map((s) => s.cash - s.floor)) : 0;
  const reconciled = run?.snaps.filter((s) => s.reconciled).length ?? 0;

  return (
    <section className="hero">
      <div className="container">
        <div className="hero-top">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="dot" /> Agentic lending · Airwallex sandbox
          </p>
          <h1 className="display">
            Lend against revenue.
            <br />
            <em>Never</em> breach the floor.
          </h1>
          <p className="lede">
            Keel is an autonomous credit agent for platforms. It collects weekly revenue-share repayments, reads each borrower's health, and sizes every advance
            against your cash reserve. Then it shows its working.
          </p>
          <div className="hero-ctas">
            <Link to="/console" className="btn btn-primary">
              Run the ten weeks <span className="arrow">→</span>
            </Link>
            <a href="#how" className="btn">
              How it decides
            </a>
          </div>
        </div>
        <LiveProof live={live} />
        </div>

        <figure className="hero-figure card">
          <div className="figure-head">
            <div>
              <div className="card-title">Platform cash, weeks 1–10</div>
              <div className="card-sub">Three borrowers · {moneyCompact(run?.fundSize ?? 0)} fund · simulated on the agent's real engine</div>
            </div>
            <div className="legend" aria-hidden="true">
              <span>
                <i className="key-line" style={{ background: "var(--accent)" }} /> Cash
              </span>
              <span>
                <i className="key-line" style={{ background: "var(--critical)" }} /> Reserve floor
              </span>
            </div>
          </div>
          <div className="figure-chart">
            {run && (
              <CashChart
                snaps={run.snaps}
                openingCash={run.fundSize}
                floor={run.snaps[0]?.floor ?? 0}
                markers={beats}
                animate
                height={340}
                label={`Platform cash stayed above the ${moneyCompact(run.snaps[0]?.floor ?? 0)} reserve floor in all ten weeks.`}
              />
            )}
          </div>
          <ol className="beats">
            {beats.map((b) => (
              <li key={b.n}>
                <span className={`beat-n beat-${b.kind}`}>{b.n}</span>
                <div>
                  <div className="beat-title">
                    <span className="muted">Week {b.week}</span> {b.title}
                  </div>
                  <p className="beat-detail">{b.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          <dl className="figure-stats">
            <div>
              <dt>Deployed</dt>
              <dd>{money(deployed)}</dd>
            </div>
            <div>
              <dt>Tightest headroom</dt>
              <dd>{money(minHeadroom)}</dd>
            </div>
            <div>
              <dt>Weeks reconciled</dt>
              <dd>
                {reconciled} of {run?.snaps.length ?? 10}
              </dd>
            </div>
          </dl>
        </figure>
      </div>
    </section>
  );
}

const RAILS = [
  { api: "connected_accounts", what: "each borrower is an Airwallex connected account" },
  { api: "connected_account_transfers", what: "advances: platform → borrower" },
  { api: "charges", what: "repayments: borrower → platform" },
  { api: "BALANCE_REPORT", what: "the bank's own portfolio snapshot" },
];

/** Proof that the same engine ran on real sandbox rails, read from the recorded run. */
function LiveProof({ live }: { live: LatestRun }) {
  const run = live.state === "ready" && live.run.source === "airwallex-sandbox" ? live.run : null;
  const settled = run?.movements.filter((m) => m.status === "settled") ?? [];
  const out = settled.filter((m) => m.kind === "disburse");
  const back = settled.filter((m) => m.kind === "collect");
  const first = out[0];
  return (
    <aside className="proof card" aria-label="Airwallex sandbox run">
      <div className="proof-head">
        <span className={`pill ${run ? "pill-good" : ""}`}>
          <span className="proof-dot" aria-hidden="true" /> {run ? "Verified on the Airwallex sandbox" : "Built on Airwallex sandbox rails"}
        </span>
        {run && <span className="muted proof-date">{runDate(run.startedAt)}</span>}
      </div>
      {run ? (
        <>
          <dl className="proof-stats">
            <div>
              <dt>Advances out</dt>
              <dd className="num">{out.length}</dd>
            </div>
            <div>
              <dt>Repayments in</dt>
              <dd className="num">{back.length}</dd>
            </div>
            <div>
              <dt>Floor breaches</dt>
              <dd className="num">{run.floorHeldEveryWeek ? 0 : "!"}</dd>
            </div>
          </dl>
          {first && (
            <div className="proof-receipt">
              <div className="artifact-row">
                <span className="muted">transfer</span> <span className="mono">{first.transferId}</span>
              </div>
              <div className="artifact-row">
                <span className="muted">request_id</span> <span className="mono">{first.requestId?.slice(0, 18)}…</span>
              </div>
              <div className="artifact-row">
                <span className="muted">amount</span> {money(first.amount)} · <span className="pill pill-good">settled</span>
              </div>
            </div>
          )}
          <p className="proof-note">
            {run.reconciledEveryWeek ? "Ledger matched the bank balance every week." : "Ledger checked against the bank every week."} Every id is the one Airwallex returned.
          </p>
        </>
      ) : (
        <ul className="proof-rails">
          {RAILS.map((r) => (
            <li key={r.api}>
              <span className="mono">{r.api}</span>
              <span className="muted">{r.what}</span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/run" className="btn btn-sm proof-link">
        {run ? "See every transfer and charge" : "How the sandbox run works"} <span className="arrow">→</span>
      </Link>
    </aside>
  );
}

function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const [ref, visible] = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={`reveal ${visible ? "is-visible" : ""} ${className}`}>
      {children}
    </div>
  );
}

function Pipeline({ run }: { run: RunResult | null }) {
  const kopi = run?.snaps.at(4)?.borrowers.find((b) => b.id === "kopi");
  const hard = run?.decisions.find((d) => d.options?.some((o) => o.breachesFloor));
  const blocked = hard?.options?.filter((o) => !o.feasible).length ?? 0;
  const chosen = hard?.options?.find((o) => o.kind === hard.chosen);
  return (
    <section className="section" id="how">
      <div className="container">
        <Reveal className="section-head">
          <p className="eyebrow">How it decides</p>
          <h2 className="h2">
            The model reads. The code decides. <span className="soft">The API moves the money.</span>
          </h2>
          <p className="section-lede">
            Keel splits judgement from authority. A language model explains and chooses among options, but only fixed, tested policy code can say which options
            exist, and only one component can touch the bank.
          </p>
        </Reveal>

        <div className="pipeline">
          <Reveal className="stage">
            <div className="stage-n">01</div>
            <h3>Reads</h3>
            <p>Each week Keel turns every borrower's revenue into signals: trend, volatility, sudden drops. Signals map to a tier: healthy, watch or stressed.</p>
            <div className="artifact">
              <div className="artifact-row">
                <span className="muted">borrower</span> kopi
              </div>
              <div className="artifact-row">
                <span className="muted">signal</span> {kopi?.reasons[0] ?? "revenue softening"}
              </div>
              <div className="artifact-row">
                <span className="muted">tier</span> {kopi ? <TierBadge tier={kopi.tier} /> : null}
              </div>
            </div>
          </Reveal>
          <Reveal className="stage">
            <div className="stage-n">02</div>
            <h3>Decides</h3>
            <p>For every request the policy engine builds each way to answer it: full, partial, delay, reallocate, decline. Anything that breaches the reserve floor is struck out before the model sees it.</p>
            <div className="artifact">
              <div className="artifact-row">
                <span className="muted">options</span> {hard?.options?.length ?? 5} built · {blocked} blocked
              </div>
              <div className="artifact-row">
                <span className="muted">chosen</span> {chosen ? optionLabel[chosen.kind] : "Reallocate capital"}
              </div>
              <div className="artifact-row">
                <span className="muted">score</span> {chosen ? money(chosen.score) : "—"}
              </div>
            </div>
          </Reveal>
          <Reveal className="stage">
            <div className="stage-n">03</div>
            <h3>Moves</h3>
            <p>One executor moves money. It checks the floor against the live balance, retries with the same idempotency key, and only records a transfer once the bank confirms it.</p>
            <div className="artifact">
              <div className="artifact-row">
                <span className="muted">key</span> collect:adv_1:w6
              </div>
              <div className="artifact-row">
                <span className="muted">attempts</span> 2 · response lost once
              </div>
              <div className="artifact-row">
                <span className="muted">status</span> <span className="pill pill-good">settled once</span>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function HardCase({ run }: { run: RunResult | null }) {
  const d = run?.decisions.find((x) => x.options?.some((o) => o.breachesFloor));
  const floor = run?.snaps[0]?.floor ?? 0;
  const full = d?.options?.find((o) => o.kind === "full");
  return (
    <section className="section section-alt" id="hard-case">
      <div className="container split">
        <Reveal className="split-copy">
          <p className="eyebrow">The hard case · week {d?.week ?? 5}</p>
          <h2 className="h2">The third advance doesn't fit. Keel finds one that does.</h2>
          <p className="section-lede">
            Nimbus Apparel asks for {money(full?.amount ?? 0)}. Paying it in full would leave {money(full?.projectedBalanceAfter ?? 0)} in platform cash, under
            the {money(floor)} floor. Rather than refuse a healthy borrower, Keel scores every alternative and takes the best one that keeps the reserve intact.
          </p>
          <ul className="ticks">
            <li>Weakest borrowers' unpaid commitments are reallocated first, never money already paid out.</li>
            <li>Moving capital always needs a human approval.</li>
            <li>The full option is shown and struck, so reviewers see what was ruled out and why.</li>
          </ul>
        </Reveal>
        <Reveal className="card decision-card">
          <div className="card-header">
            <div>
              <div className="card-title">Nimbus Apparel requests {money(full?.amount ?? 0)}</div>
              <div className="card-sub">Week {d?.week} · platform cash {money((d?.inputs.platformBalance as number) ?? 0)} · floor {money(floor)}</div>
            </div>
            <TierBadge tier="healthy" />
          </div>
          <div className="decision-body">{d?.options && <OptionBars options={d.options} chosen={d.chosen} floor={floor} />}</div>
          <blockquote className="memo">
            <span className="eyebrow">Credit memo</span>
            <p>{d?.memo}</p>
          </blockquote>
        </Reveal>
      </div>
    </section>
  );
}

function LateMoney({ run }: { run: RunResult | null }) {
  const lateEvent = run?.events.find((e) => e.text.includes("has not settled"));
  const caught = run?.events.find((e) => e.text.includes("catch-up"));
  const promise = run?.decisions.find((d) => d.type === "commitment");
  const amounts = lateEvent?.text.match(/\$[\d,]+/g) ?? [];
  const promised = (promise?.inputs.commitment as { amount: number } | undefined)?.amount ?? 0;
  return (
    <section className="section" id="late-money">
      <div className="container">
        <Reveal className="section-head">
          <p className="eyebrow">Underpayments and promises</p>
          <h2 className="h2">Late money isn't bad credit. Old promises aren't blank cheques.</h2>
          <p className="section-lede">
            Real portfolios don't pay on schedule. Keel tells a customer paying late apart from a business in trouble, and re-checks every promised advance against
            today's cash and today's borrower before the money moves.
          </p>
        </Reveal>
        <div className="late-grid">
          <Reveal className="card late-card">
            <div className="late-top">
              <span className="pill pill-warn">Week {lateEvent?.week ?? 6} · paid late</span>
              <TierBadge tier="healthy" />
            </div>
            <h3 className="late-title">Ledgerly's customers pay a week late</h3>
            <ol className="timeline">
              <li>
                <span className="tl-week num">W{lateEvent?.week ?? 6}</span>
                <div>
                  <strong>{amounts[1] ?? "$8,664"} sold, {amounts[0] ?? "$5,199"} not settled.</strong>
                  <p>Keel takes its share of what arrived and books {amounts[2] ?? "$520"} as a receivable. Sales are on trend, so the tier stays healthy.</p>
                </div>
              </li>
              <li>
                <span className="tl-week num">W{caught?.week ?? 7}</span>
                <div>
                  <strong>The late payments land.</strong>
                  <p>Keel collects the catch-up the same week and clears the receivable. Nothing written off, nothing frozen.</p>
                </div>
              </li>
            </ol>
          </Reveal>
          <Reveal className="card late-card">
            <div className="late-top">
              <span className="pill pill-accent">Week {promise?.week ?? 6} · promise re-checked</span>
              <TierBadge tier="watch" />
            </div>
            <h3 className="late-title">Kopi's top-up comes due after Kopi softens</h3>
            <ol className="timeline">
              <li>
                <span className="tl-week num">W0</span>
                <div>
                  <strong>An $8,000 top-up is promised.</strong>
                  <p>Kopi is healthy. The advance is booked as a commitment for week 6.</p>
                </div>
              </li>
              <li>
                <span className="tl-week num">W5</span>
                <div>
                  <strong>Part of it funds Nimbus instead.</strong>
                  <p>Kopi's sales are slipping, so its unpaid promise is the first capital Keel reallocates.</p>
                </div>
              </li>
              <li>
                <span className="tl-week num">W{promise?.week ?? 6}</span>
                <div>
                  <strong>
                    The remaining {money(promised)} is {promise?.chosen === "decline" ? "withdrawn" : `re-sized: ${optionLabel[promise?.chosen ?? "partial"]?.toLowerCase()}`}.
                  </strong>
                  <p>Before paying, Keel re-runs the decision. Kopi is on watch and already at its capacity, so a stale yes becomes a fresh no.</p>
                </div>
              </li>
            </ol>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Portfolio({ run }: { run: RunResult | null }) {
  const end = run?.snaps.at(-1);
  return (
    <section className="section">
      <div className="container">
        <Reveal className="section-head">
          <p className="eyebrow">When a borrower stumbles</p>
          <h2 className="h2">Repayments that bend instead of break.</h2>
          <p className="section-lede">
            Repayment is a share of each week's revenue, so a bad week means a smaller repayment, not a default. When revenue collapses Keel freezes new credit for
            that borrower and keeps collecting what the business can afford.
          </p>
        </Reveal>
        <div className="borrowers">
          {end?.borrowers.map((b) => (
            <Reveal key={b.id} className="card borrower">
              <div className="borrower-top">
                <div>
                  <div className="card-title">{b.name}</div>
                  <div className="card-sub">{borrowerSector[b.id]}</div>
                </div>
                <TierBadge tier={b.tier} />
              </div>
              <Sparkline values={b.revenue} width={260} height={56} label={`${b.name} weekly revenue`} />
              <dl className="borrower-stats">
                <div>
                  <dt>Owed</dt>
                  <dd className="num">{money(b.outstanding)}</dd>
                </div>
                <div>
                  <dt>Holdback</dt>
                  <dd className="num">{pct(b.holdbackBps)} of revenue</dd>
                </div>
              </dl>
              <p className="borrower-note">{b.reasons[0]}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Guarantees({ run }: { run: RunResult | null }) {
  const weeks = run?.snaps.length ?? 10;
  const reconciled = run?.snaps.filter((s) => s.reconciled).length ?? 10;
  const items = [
    { big: "0", unit: "floor breaches", text: "Every test run checks 2,000 random portfolios: no option the engine approves ever leaves cash below the floor." },
    { big: "1×", unit: "per transfer", text: "Each money movement has a fixed idempotency key. Retrying after a lost response returns the original transfer." },
    { big: `${reconciled}/${weeks}`, unit: "weeks reconciled", text: "The agent's own ledger is checked against the bank balance at the end of every week." },
    { big: "$20K", unit: "approval line", text: "Advances above $20K, and any reallocation of capital, wait for a person to approve them." },
  ];
  return (
    <section className="section section-alt" id="guarantees">
      <div className="container">
        <Reveal className="section-head">
          <p className="eyebrow">Guarantees, tested</p>
          <h2 className="h2">Claims you can run, not just read.</h2>
        </Reveal>
        <div className="guarantees">
          {items.map((g) => (
            <Reveal key={g.unit} className="guarantee">
              <div className="g-big">{g.big}</div>
              <div className="g-unit">{g.unit}</div>
              <p>{g.text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="closing">
      <div className="container closing-inner">
        <h2 className="display display-sm">
          Run the ten weeks <em>yourself.</em>
        </h2>
        <p className="section-lede">Step through each week, approve the hard calls, and push a borrower into a revenue shock to see how Keel responds.</p>
        <Link to="/console" className="btn btn-primary">
          Open the console <span className="arrow">→</span>
        </Link>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <Wordmark />
        <nav className="footer-links" aria-label="Footer">
          <Link to="/console">Console</Link>
          <Link to="/run">Sandbox run</Link>
          <a href="https://github.com/softalpha0/Keel" target="_blank" rel="noreferrer">
            Source
          </a>
        </nav>
        <p className="muted">
          Built for the Airwallex Agentic Banking Hackathon 2026. A sandbox simulation, not a lending offer. Not affiliated with or endorsed by Airwallex.
        </p>
      </div>
    </footer>
  );
}
