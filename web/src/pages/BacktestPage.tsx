import { useMemo } from "react";
import { Link } from "react-router-dom";
import { backtest, type StrategyResult } from "../../../src/backtest/backtest";
import { ARCHETYPES } from "../../../src/backtest/history";
import { ThemeToggle, Wordmark } from "../components/Brand";
import { moneyCompact } from "../lib/format";
import { loadParams } from "../lib/workspace";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const signed = (x: number) => `${x >= 0 ? "+" : "−"}${(Math.abs(x) * 100).toFixed(1)}%`;

/**
 * Cyrus at Airwallex asked the right question: keeping cash above the floor is one thing, but will
 * the loans repay? This replays Keel's policy over two years of merchant history and keeps score.
 */
export function BacktestPage() {
  const params = useMemo(loadParams, []);
  const r = useMemo(
    () => backtest({ policy: { advanceMultipleWeeks: params.advanceWeeks, maxBorrowerExposureBps: params.maxExposurePct * 100 } }),
    [params.advanceWeeks, params.maxExposurePct],
  );
  return (
    <div className="console">
      <header className="topbar">
        <div className="topbar-inner">
          <Wordmark />
          <span className="topbar-sep" aria-hidden="true" />
          <div className="topbar-title">
            <strong>Backtest</strong>
            <span className="muted">Keel's policy over two years of merchant history</span>
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
      <main className="page-main backtest">
        <section className="safety-head">
          <p className="eyebrow">Will the loans repay?</p>
          <h1 className="h2">Keel's policy, replayed over {r.merchants} merchants and two years of sales.</h1>
          <p className="section-lede">
            Each merchant asks for money every twelve weeks during the first year. Keel decides with its real health signals and limits; a lender without them uses the same sizing
            rule for anyone who asks. Both collect the same {r.holdbackBps / 100}% of sales, and anything still owed a year after the last advance is written off.
          </p>
        </section>

        <section className="bt-compare">
          <Strategy title="Keel" sub="Health tiers, refunds, per-borrower limit" s={r.keel} good />
          <Strategy title="Without health checks" sub="Same sizing rule, lends to anyone who asks" s={r.naive} />
        </section>

        <section className="card panel">
          <div className="card-header">
            <div>
              <h2 className="card-title">By kind of merchant</h2>
              <p className="card-sub">Share of principal lent that was never repaid.</p>
            </div>
          </div>
          <div className="panel-body table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Merchants</th>
                  <th scope="col" className="r">
                    Keel lent
                  </th>
                  <th scope="col" className="r">
                    Keel loss
                  </th>
                  <th scope="col" className="r">
                    Without checks lent
                  </th>
                  <th scope="col" className="r">
                    Loss
                  </th>
                </tr>
              </thead>
              <tbody>
                {ARCHETYPES.map((a) => {
                  const k = r.keel.byArchetype[a.kind];
                  const n = r.naive.byArchetype[a.kind];
                  return (
                    <tr key={a.kind}>
                      <th scope="row">
                        {a.label} <span className="muted">· {Math.round(a.share * r.merchants)}</span>
                        <div className="muted bt-story">{a.story}</div>
                      </th>
                      <td className="r num">{moneyCompact(k.lent)}</td>
                      <td className={`r num ${k.lossRate > 0.2 ? "bt-bad" : k.lossRate < 0.01 ? "bt-good" : ""}`}>{pct(k.lossRate)}</td>
                      <td className="r num muted">{moneyCompact(n.lent)}</td>
                      <td className={`r num ${n.lossRate > 0.2 ? "bt-bad" : ""}`}>{pct(n.lossRate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card panel bt-notes">
          <h2 className="card-title">What this does and doesn't show</h2>
          <ul>
            <li>
              <strong>Keel can't see a sudden closure coming.</strong> It lends to a healthy merchant, and if sales fall to zero within a month, most of that advance is lost. The health
              tiers only stop it lending more.
            </li>
            <li>
              <strong>Refunds matter.</strong> In the refund spiral, sales hold up for weeks while refunds climb. The refund signal puts those merchants on watch before revenue drops.
            </li>
            <li>
              <strong>The history is synthetic.</strong> It stands in for a platform's real sales data, which is what a pilot would backtest on before raising limits. The engine and rules
              are the same ones the credit desk and the sandbox run use.
            </li>
            <li>
              Run with your platform rules: advances of {params.advanceWeeks} weeks of sales, limit {params.maxExposurePct}% of a $100K book per borrower.{" "}
              <Link to="/desk">Change them on the credit desk</Link>.
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}

function Strategy({ title, sub, s, good }: { title: string; sub: string; s: StrategyResult; good?: boolean }) {
  return (
    <div className={`card bt-card${good ? " is-keel" : ""}`}>
      <div>
        <h2 className="card-title">{title}</h2>
        <p className="card-sub">{sub}</p>
      </div>
      <dl className="bt-kpis">
        <div>
          <dt>Loss rate</dt>
          <dd className={`num ${s.lossRate > 0.2 ? "bt-bad" : ""}`}>{pct(s.lossRate)}</dd>
        </div>
        <div>
          <dt>Net return</dt>
          <dd className={`num ${s.netReturn < 0 ? "bt-bad" : "bt-good"}`}>{signed(s.netReturn)}</dd>
        </div>
        <div>
          <dt>Lent</dt>
          <dd className="num">{moneyCompact(s.lent)}</dd>
        </div>
        <div>
          <dt>Collected</dt>
          <dd className="num">{moneyCompact(s.collected)}</dd>
        </div>
        <div>
          <dt>Advances</dt>
          <dd className="num">{s.advances}</dd>
        </div>
        <div>
          <dt>Median payback</dt>
          <dd className="num">{s.medianPaybackWeeks} wks</dd>
        </div>
      </dl>
    </div>
  );
}
