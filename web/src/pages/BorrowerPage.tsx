import { Link, useParams } from "react-router-dom";
import { ThemeToggle, Wordmark } from "../components/Brand";
import { RevenueBars } from "../components/RevenueBars";
import { TierBadge } from "../components/Status";
import { borrowerSector, money, moneyIn, optionLabel, pct } from "../lib/format";
import { useLatestRun } from "../lib/run";
import { useDemoRun, type RunResult } from "../lib/sim";
import { NotFound } from "./NotFound";

const IDS = ["kopi", "nimbus", "ledgerly"];

/** Everything Keel knows and did about one borrower: the operator's view. */
export function BorrowerPage() {
  const { id = "" } = useParams();
  const run = useDemoRun();
  if (!IDS.includes(id)) return <NotFound />;
  return (
    <div className="console">
      <header className="topbar">
        <div className="topbar-inner">
          <Wordmark />
          <span className="topbar-sep" aria-hidden="true" />
          <div className="topbar-title">
            <strong>Borrowers</strong>
            <span className="muted">Simulated ten weeks on Keel's engine</span>
          </div>
          <div className="topbar-actions">
            <ThemeToggle />
            <Link to="/desk" className="btn btn-ghost btn-sm">
              Credit desk
            </Link>
            <Link to="/run" className="btn btn-ghost btn-sm">
              Sandbox run
            </Link>
          </div>
        </div>
      </header>
      <main className="page-main">
        <nav className="seg seg-wide" aria-label="Borrower">
          {IDS.map((b) => (
            <Link key={b} to={`/borrowers/${b}`} className={b === id ? "is-on" : ""} aria-current={b === id ? "page" : undefined}>
              {run?.borrowers.find((x) => x.id === b)?.name ?? b}
            </Link>
          ))}
        </nav>
        {run ? <Borrower run={run} id={id} /> : null}
      </main>
    </div>
  );
}

function Borrower({ run, id }: { run: RunResult; id: string }) {
  const b = run.borrowers.find((x) => x.id === id)!;
  const end = run.snaps.at(-1)!.borrowers.find((x) => x.id === id)!;
  const ccy = b.currency ?? "USD";
  const { ledger } = run;
  const advances = ledger.advances.filter((a) => a.borrowerId === id);
  const repayments = ledger.receipts.filter((r) => r.borrowerId === id && r.kind === "collect" && r.status === "settled");
  const receivables = ledger.receivables.filter((r) => r.borrowerId === id);
  const decisions = ledger.decisions.filter((d) => d.borrowerId === id);
  const advanced = advances.reduce((s, a) => s + a.principal, 0);
  const repaid = repayments.reduce((s, r) => s + r.amount, 0);
  const weeks = run.snaps.map((s) => {
    const x = s.borrowers.find((y) => y.id === id)!;
    return { week: s.week, revenue: x.revenue.at(-1) ?? 0, tier: x.tier };
  });
  const live = useLatestRun();
  const sandbox = live.state === "ready" ? live.run : null;
  const sandboxMoves = sandbox?.movements.filter((m) => m.borrowerId === id && m.status === "settled") ?? [];

  return (
    <div className="borrower-page">
      <section className="bp-head">
        <div>
          <p className="eyebrow">{borrowerSector[id]}</p>
          <h1 className="h2">
            {b.name}
            {ccy !== "USD" && <span className="pill ccy-chip">repays in {ccy}</span>}
          </h1>
          <p className="muted bp-reasons">{end.reasons.join(" · ") || "No signals yet"}</p>
        </div>
        <div className="bp-head-actions">
          <TierBadge tier={end.tier} />
          <Link to={`/portal/${id}`} className="btn btn-sm">
            See what {b.name.split(" ")[0]} sees <span className="arrow">→</span>
          </Link>
        </div>
      </section>

      <section className="kpis" aria-label={`${b.name} at a glance`}>
        <div className="kpi card kpi-hero">
          <div className="kpi-label">Owed now</div>
          <div className="kpi-value">{money(end.outstanding)}</div>
          <div className="kpi-note">principal + fee still to collect</div>
        </div>
        <div className="kpi card">
          <div className="kpi-label">Advanced</div>
          <div className="kpi-value">{money(advanced)}</div>
          <div className="kpi-note">{advances.length} advance{advances.length === 1 ? "" : "s"}</div>
        </div>
        <div className="kpi card">
          <div className="kpi-label">Repaid</div>
          <div className="kpi-value">{money(repaid)}</div>
          <div className="kpi-note">{pct(b.holdbackBps)} of weekly sales</div>
        </div>
        <div className="kpi card">
          <div className="kpi-label">Can draw now</div>
          <div className="kpi-value">{money(run.capacity[id] ?? 0)}</div>
          <div className="kpi-note">{end.tier === "stressed" ? "frozen while stressed" : "after health and exposure limits"}</div>
        </div>
      </section>

      <section className="card panel">
        <div className="card-header">
          <div>
            <h2 className="card-title">Weekly sales and health</h2>
            <p className="card-sub">In USD{ccy !== "USD" ? `, converted from ${ccy} at each week's rate` : ""}. The tier under each week is what Keel lent against.</p>
          </div>
        </div>
        <div className="panel-body">
          <RevenueBars weeks={weeks} label={`${b.name} weekly sales across ${weeks.length} weeks`} />
        </div>
      </section>

      <div className="bp-grid">
        <section className="card panel">
          <div className="card-header">
            <div>
              <h2 className="card-title">Advances</h2>
              <p className="card-sub">Paid out in USD to {b.name}'s Airwallex connected account.</p>
            </div>
          </div>
          <div className="panel-body table-wrap">
            {advances.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Advance</th>
                    <th>Week</th>
                    <th className="r">Principal</th>
                    <th className="r">Fee</th>
                    <th className="r">Outstanding</th>
                    <th className="r">Repaid</th>
                  </tr>
                </thead>
                <tbody>
                  {advances.map((a) => (
                    <tr key={a.id}>
                      <td className="mono">{a.id}</td>
                      <td className="num">W{a.disbursedWeek}</td>
                      <td className="r num">{money(a.principal)}</td>
                      <td className="r num">{money(a.fee)}</td>
                      <td className="r num">{money(a.outstanding)}</td>
                      <td className="r num">{Math.round(((a.principal + a.fee - a.outstanding) / (a.principal + a.fee)) * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty empty-sm">No advances in this run.</p>
            )}
          </div>
        </section>

        <section className="card panel">
          <div className="card-header">
            <div>
              <h2 className="card-title">Repayments</h2>
              <p className="card-sub">Charged from the borrower's wallet each week{ccy !== "USD" ? ` in ${ccy}, then converted` : ""}.</p>
            </div>
          </div>
          <div className="panel-body table-wrap bp-scroll">
            {repayments.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Type</th>
                    <th className="r">Charged</th>
                    <th className="r">To the fund</th>
                  </tr>
                </thead>
                <tbody>
                  {repayments.map((r) => (
                    <tr key={r.idempotencyKey}>
                      <td className="num">W{r.week}</td>
                      <td>
                        {r.idempotencyKey.startsWith("catchup:") ? "Catch-up" : "Revenue share"}
                        {r.attempts > 1 && <span className="pill">retried</span>}
                      </td>
                      <td className="r num">{r.fx ? moneyIn(r.fx.localAmount, r.fx.currency) : money(r.amount)}</td>
                      <td className="r num">
                        {money(r.amount)}
                        {r.fx && <div className="muted">@ {r.fx.rate.toFixed(4)}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty empty-sm">Nothing collected yet.</p>
            )}
          </div>
        </section>
      </div>

      {receivables.length > 0 && (
        <section className="card panel">
          <div className="card-header">
            <div>
              <h2 className="card-title">Receivables</h2>
              <p className="card-sub">Repayment share that was due but not collectable that week.</p>
            </div>
          </div>
          <div className="panel-body table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Why</th>
                  <th className="r">Owed</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {receivables.map((r) => (
                  <tr key={r.id}>
                    <td className="num">W{r.week}</td>
                    <td>{r.reason === "late-payment" ? "Customer payments settled late" : "Wallet could not cover the charge"}</td>
                    <td className="r num">{moneyIn(r.amount, r.currency ?? ccy)}</td>
                    <td>{r.settledWeek ? <span className="pill pill-good">Cleared W{r.settledWeek}</span> : <span className="pill pill-warn">Open</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card panel">
        <div className="card-header">
          <div>
            <h2 className="card-title">Every decision about {b.name}</h2>
            <p className="card-sub">With the memo written at the time.</p>
          </div>
        </div>
        <ol className="run-decisions">
          {decisions.map((d, i) => (
            <li key={i}>
              <div className="run-decision-top">
                <span className="muted num">W{d.week}</span>
                <span className={`pill ${d.type === "health-review" ? "pill-critical" : "pill-accent"}`}>
                  {d.type === "health-review" ? "Health review" : d.type === "commitment" && d.chosen === "decline" ? "Promise withdrawn" : optionLabel[d.chosen ?? "decline"]}
                </span>
                {d.approval?.required && <span className="pill">{d.approval.approved ? `approved by ${d.approval.by}` : `rejected by ${d.approval.by}`}</span>}
              </div>
              <p className="secondary">{d.memo}</p>
            </li>
          ))}
          {!decisions.length && <li className="muted">No decisions about {b.name} in this run.</li>}
        </ol>
      </section>

      {sandbox && sandboxMoves.length > 0 && (
        <section className="card panel bp-sandbox">
          <div className="card-header">
            <div>
              <h2 className="card-title">{b.name} on the Airwallex sandbox</h2>
              <p className="card-sub">
                Connected account <span className="mono">{sandbox.borrowers.find((x) => x.id === id)?.accountId}</span> ·{" "}
                {sandboxMoves.filter((m) => m.kind === "disburse").length} advance(s), {sandboxMoves.filter((m) => m.kind === "collect").length} repayments with real Airwallex ids.
              </p>
            </div>
            <Link to="/run" className="btn btn-sm">
              See them <span className="arrow">→</span>
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
