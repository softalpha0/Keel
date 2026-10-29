import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { RunRecord } from "../../../src/sim/record";
import { ThemeToggle, Wordmark } from "../components/Brand";
import { CashChart } from "../components/CashChart";
import { Check, Cross } from "../components/Status";
import { money, moneyIn, optionLabel } from "../lib/format";
import { runDate, useLatestRun, useRunHistory } from "../lib/run";
import type { RunSummary } from "../../../src/sim/record";
import { describeAsOf } from "../../../src/reconcile/portfolio";
import { AskPanel, SparkIcon } from "../components/AskPanel";
import { compactDecisions, compactEvents } from "../lib/ask";
import type { WeekSnap } from "../lib/sim";

export function RunPage() {
  const [params, setParams] = useSearchParams();
  const file = params.get("run") ?? "latest.json";
  const load = useLatestRun(file);
  const history = useRunHistory();
  const [asking, setAsking] = useState(false);
  const run = load.state === "ready" ? load.run : null;
  const askContext = useMemo(() => {
    if (!run) return null;
    const offset = run.fund.openingBalance - run.fund.size;
    const names = Object.fromEntries(run.borrowers.map((b) => [b.id, b.name]));
    return {
      source: run.source,
      reserveFloor: run.fund.reserveFloor - offset,
      // Fund-relative cash, so amounts read like the $100K fund rather than the whole sandbox wallet.
      weeks: run.weeks.map((w) => ({ week: w.week, cash: w.platformBalance - offset, floorHeld: w.floorHeld, reconciled: w.reconciled })),
      borrowers: run.borrowers.map((b) => ({ id: b.id, name: b.name, currency: b.currency })),
      decisions: compactDecisions(run.decisions, names).map((d) => ({ ...d, options: d.options?.map((o) => ({ ...o, cashAfter: o.cashAfter - offset })) })),
      events: compactEvents(run.events),
      notes: [
        ...(run.portfolio
          ? run.portfolio.rows.map(
              (r) =>
                `Wallet check ${r.label} ${r.currency}: ledger ${r.expected}, live ${r.live}, bank report ${r.report ?? "n/a"}${r.reportAsOf !== undefined && r.reportAsOf !== "now" ? ` (report equals the ledger ${describeAsOf(r.reportAsOf)})` : ""}${r.reportStale ? " (report line predates the run)" : ""}, ${r.match ? "matches" : "MISMATCH"}. Platform figures are absolute wallet balances, not fund-relative.`,
            )
          : []),
        ...(run.balanceReport?.id ? [`Airwallex BALANCE_REPORT id ${run.balanceReport.id}.`] : []),
      ],
    };
  }, [run]);

  return (
    <div className="console">
      <header className="topbar">
        <div className="topbar-inner">
          <Wordmark />
          <span className="topbar-sep" aria-hidden="true" />
          <div className="topbar-title">
            <strong>Sandbox run</strong>
            <span className="muted">Every money movement, with the bank's own ids</span>
          </div>
          <div className="topbar-actions">
            {run && (
              <button className="btn btn-sm btn-ask" onClick={() => setAsking(true)}>
                <SparkIcon /> Ask Keel
              </button>
            )}
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
      <main className="run-main">
        {history.length > 0 && <RunHistory history={history} current={file} onPick={(f) => setParams(f === history[0]?.file ? {} : { run: f })} />}
        {load.state === "loading" ? null : load.state === "missing" ? <NoRun /> : <Run run={load.run} />}
      </main>
      <AskPanel
        open={asking}
        onClose={() => setAsking(false)}
        context={askContext}
        suggestions={["Which decisions did Claude make, and why?", "Why was Kopi's pending advance withdrawn?", "Did the floor ever come under pressure?", "What did the bank's balance report show?"]}
      />
    </div>
  );
}

/** Every published sandbox run; the daily GitHub Action adds one a day. */
function RunHistory({ history, current, onPick }: { history: RunSummary[]; current: string; onPick: (file: string) => void }) {
  const active = current === "latest.json" ? history[0]?.file : current;
  const clean = history.filter((h) => h.floorHeldEveryWeek && h.reconciledEveryWeek && h.walletsMatch !== false).length;
  return (
    <section className="run-history" aria-label="Run history">
      <div className="rh-head">
        <strong>
          {history.length} sandbox run{history.length === 1 ? "" : "s"}
        </strong>
        <span className="muted">
          {clean === history.length ? "every one held the floor and reconciled" : `${clean} of ${history.length} fully clean`} · newest first
        </span>
      </div>
      <div className="rh-list" role="list">
        {history.slice(0, 14).map((h) => {
          const ok = h.floorHeldEveryWeek && h.reconciledEveryWeek && h.walletsMatch !== false;
          return (
            <button key={h.file} role="listitem" className={`rh-item${h.file === active ? " is-on" : ""}`} onClick={() => onPick(h.file)} aria-pressed={h.file === active}>
              <span className={`rh-dot ${ok ? "is-ok" : "is-bad"}`} aria-hidden="true" />
              <span>{runDate(h.startedAt)}</span>
              <span className="muted">{h.byClaude ? `Claude ${h.byClaude}/${h.decisions}` : "rules"}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function NoRun() {
  return (
    <section className="card run-empty">
      <h1 className="dialog-title">No recorded run yet</h1>
      <p className="secondary">
        This page shows a run of Keel against the Airwallex sandbox: each advance and repayment with the transfer and charge ids Airwallex returned.
      </p>
      <ol className="run-steps">
        <li>
          Record a live run: <code className="mono">npm run demo:sandbox</code>
        </li>
        <li>
          Or preview the page with the simulated bank: <code className="mono">npm run demo -- --record</code>
        </li>
        <li>Reload this page.</li>
      </ol>
    </section>
  );
}

function Run({ run }: { run: RunRecord }) {
  const live = run.source === "airwallex-sandbox";
  // In the sandbox the wallet holds millions; chart only the ring-fenced lending fund.
  const offset = run.fund.openingBalance - run.fund.size;
  const snaps = useMemo<WeekSnap[]>(
    () =>
      run.weeks.map((w) => ({
        week: w.week,
        cash: w.platformBalance - offset,
        floor: run.fund.reserveFloor - offset,
        committed: 0,
        outstanding: 0,
        feesBooked: 0,
        collectedToDate: 0,
        receivableOpen: 0,
        reconciled: w.reconciled,
        floorHeld: w.floorHeld,
        borrowers: [],
      })),
    [run, offset],
  );
  const names = Object.fromEntries(run.borrowers.map((b) => [b.id, b.name]));
  const accounts = Object.fromEntries(run.borrowers.map((b) => [b.id, b.accountId]));
  const out = run.movements.filter((m) => m.kind === "disburse" && m.status === "settled");
  const back = run.movements.filter((m) => m.kind === "collect" && m.status === "settled");
  const retried = run.movements.filter((m) => m.attempts > 1).length;
  const byClaude = run.decisions.filter((d) => d.decidedBy === "claude" && d.type !== "health-review").length;
  const decidable = run.decisions.filter((d) => d.type !== "health-review").length;
  const viaWebhook = run.movements.filter((m) => m.confirmedBy === "webhook").length;
  const ccy = Object.fromEntries(run.borrowers.map((b) => [b.id, b.currency ?? "USD"]));
  // Older run files predate receivable ids and catch-up; treat their rows as still open.
  const receivables = run.receivables.map((r) => ({ ...r, collected: r.collected ?? 0, reason: r.reason ?? "wallet-short" }));
  const owed = receivables.reduce((s, r) => s + r.amount - r.collected, 0);
  const caughtUp = receivables.reduce((s, r) => s + r.collected, 0);
  const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);

  return (
    <div className="run">
      <section className="run-head">
        <div className="run-badges">
          <span className={`pill ${live ? "pill-good" : ""}`}>{live ? "Airwallex sandbox" : "Simulated bank"}</span>
          <span className={`pill ${run.floorHeldEveryWeek ? "pill-good" : "pill-critical"}`}>
            {run.floorHeldEveryWeek ? <Check size={12} /> : <Cross size={12} />} Floor held every week
          </span>
          <span className={`pill ${run.reconciledEveryWeek ? "pill-good" : "pill-critical"}`}>
            {run.reconciledEveryWeek ? <Check size={12} /> : <Cross size={12} />} Ledger matches bank every week
          </span>
          {run.portfolio && (
            <span className={`pill ${run.portfolio.allMatch ? "pill-good" : "pill-critical"}`}>
              {run.portfolio.allMatch ? <Check size={12} /> : <Cross size={12} />} Every wallet reconciled
            </span>
          )}
          {byClaude > 0 && <span className="pill pill-accent">Decisions by Claude</span>}
        </div>
        <h1 className="h2">{live ? "Ten weeks on real sandbox rails." : "Ten weeks on the simulated bank."}</h1>
        <p className="muted run-meta">
          Run <span className="mono">{run.runId}</span> · {new Date(run.startedAt).toLocaleString()} · {money(run.fund.size)} fund · floor{" "}
          {money(run.fund.reserveFloor - offset)} inside the fund
        </p>
        {run.balanceReport && (
          <p className="muted run-meta">
            Airwallex <span className="mono">BALANCE_REPORT</span>{" "}
            {run.balanceReport.error ? (
              <>requested; the API returned an error, kept in the run file</>
            ) : (
              <>
                requested at the end of the run{run.balanceReport.id && <> · <span className="mono">{run.balanceReport.id}</span></>}
                {run.balanceReport.status && <> · {run.balanceReport.status.toLowerCase()}</>}
              </>
            )}
          </p>
        )}
      </section>

      <section className="kpis" aria-label="Run totals">
        <div className="kpi card kpi-hero">
          <div className="kpi-label">Advances paid out</div>
          <div className="kpi-value">{money(sum(out))}</div>
          <div className="kpi-note">{out.length} connected account transfers</div>
        </div>
        <div className="kpi card">
          <div className="kpi-label">Repayments collected</div>
          <div className="kpi-value">{money(sum(back))}</div>
          <div className="kpi-note">{back.length} charges</div>
        </div>
        <div className="kpi card">
          <div className="kpi-label">Still owed</div>
          <div className="kpi-value">{money(owed)}</div>
          <div className="kpi-note">
            {!receivables.length ? "every repayment covered" : caughtUp ? `${money(caughtUp)} late money caught up` : `${receivables.length} receivable(s) open`}
          </div>
        </div>
        {byClaude > 0 ? (
          <div className="kpi card">
            <div className="kpi-label">Decided by Claude</div>
            <div className="kpi-value">
              {byClaude}/{decidable}
            </div>
            <div className="kpi-note">within policy-feasible options only</div>
          </div>
        ) : (
          <div className="kpi card">
            <div className="kpi-label">Retries recovered</div>
            <div className="kpi-value">{retried}</div>
            <div className="kpi-note">no duplicate money movement</div>
          </div>
        )}
      </section>

      <section className="card panel">
        <div className="card-header">
          <div>
            <h2 className="card-title">Lending fund cash vs reserve floor</h2>
            <p className="card-sub">{live ? "Platform wallet minus the cash outside the ring-fenced fund." : "Platform cash."}</p>
          </div>
        </div>
        <div className="panel-body">
          <CashChart snaps={snaps} openingCash={run.fund.size} floor={run.fund.reserveFloor - offset} height={260} label="Lending fund cash across the recorded run" />
        </div>
      </section>

      <section className="card panel">
        <div className="card-header">
          <div>
            <h2 className="card-title">Money movements</h2>
            <p className="card-sub">
              {live ? "Ids as returned by Airwallex. Search any of them in the sandbox dashboard." : "Ids from the simulated bank."} Every movement was confirmed by reading
              it back before Keel recorded it.
            </p>
          </div>
        </div>
        <div className="panel-body table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Week</th>
                <th>Type</th>
                <th>Borrower</th>
                <th className="r">Amount</th>
                <th>{live ? "Airwallex id" : "Transfer id"}</th>
                {live && <th>request_id</th>}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {run.movements.map((m) => (
                <tr key={m.idempotencyKey}>
                  <td className="num">W{m.week}</td>
                  <td>{m.kind === "disburse" ? "Advance → borrower" : m.idempotencyKey.startsWith("catchup:") ? "Catch-up → platform" : "Repayment → platform"}</td>
                  <td>
                    {names[m.borrowerId] ?? m.borrowerId}
                    <div className="mono muted">{accounts[m.borrowerId]}</div>
                  </td>
                  <td className="r num">
                    {m.fx ? (
                      <>
                        {moneyIn(m.fx.localAmount, m.fx.currency)}
                        <div className="muted">
                          → {money(m.amount)} @ {m.fx.rate.toFixed(4)}
                        </div>
                      </>
                    ) : (
                      money(m.amount)
                    )}
                  </td>
                  <td className="mono">
                    {m.transferId}
                    {m.fx && <div className="muted">{m.fx.conversionId}</div>}
                  </td>
                  {live && <td className="mono muted">{m.requestId}</td>}
                  <td>
                    <span className={`pill ${m.status === "settled" ? "pill-good" : "pill-critical"}`}>{m.status === "settled" ? "Settled" : m.status}</span>
                    {m.attempts > 1 && <span className="pill">retried ×{m.attempts - 1}</span>}
                    {m.confirmedBy === "webhook" && <span className="pill">via webhook</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {run.portfolio && (
        <section className="card panel">
          <div className="card-header">
            <div>
              <h2 className="card-title">Every wallet, three ways</h2>
              <p className="card-sub">
                At the end of the run each wallet Keel touched is checked against its own ledger, the live balance API{run.portfolio.reportId ? ", and the bank's own BALANCE_REPORT" : ""}.
                {viaWebhook > 0 && ` ${viaWebhook} money movements were confirmed by signed Airwallex webhooks.`}
              </p>
            </div>
          </div>
          <div className="panel-body table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Wallet</th>
                  <th className="r">Keel's ledger</th>
                  <th className="r">Live balance</th>
                  <th className="r">Bank report</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {run.portfolio.rows.map((r) => (
                  <tr key={`${r.accountId}-${r.currency}`}>
                    <td>
                      {r.label} <span className="pill">{r.currency}</span>
                      <div className="mono muted">{r.accountId}</div>
                    </td>
                    <td className="r num">{moneyIn(r.expected - (r.label === "Platform" ? offset : 0), r.currency)}</td>
                    <td className="r num">{moneyIn(r.live - (r.label === "Platform" ? offset : 0), r.currency)}</td>
                    <td className="r num">
                      {r.report === undefined ? "—" : moneyIn(r.report - (r.label === "Platform" ? offset : 0), r.currency)}
                      {r.report !== undefined && r.reportAsOf !== "now" && (
                        <div className="muted">{r.reportStale ? "snapshot predates this run" : `= ledger ${describeAsOf(r.reportAsOf)}`}</div>
                      )}
                    </td>
                    <td>{r.match ? <span className="pill pill-good">Matches</span> : <span className="pill pill-critical">Mismatch</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {run.portfolio.reportLags && (
              <p className="muted run-note">
                Airwallex builds the BALANCE_REPORT from data that lags the live balance, so each report line is checked against Keel's ledger at the moment it
                reflects. The live balance must match the ledger now.
              </p>
            )}
            {run.portfolio.reportError && <p className="muted run-note">Bank report unavailable: {run.portfolio.reportError}. Checked against the live balance API.</p>}
            {live && <p className="muted run-note">Platform figures are shown inside the ring-fenced fund; borrower wallets are their full sandbox balances.</p>}
          </div>
        </section>
      )}

      {receivables.length > 0 && (
        <section className="card panel">
          <div className="card-header">
            <div>
              <h2 className="card-title">Receivables</h2>
              <p className="card-sub">Repayments that were due but not collectable yet, and when Keel caught up on them.</p>
            </div>
          </div>
          <div className="panel-body table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Borrower</th>
                  <th>Why</th>
                  <th className="r">Owed</th>
                  <th className="r">Collected</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {receivables.map((r) => (
                  <tr key={r.id ?? `${r.week}-${r.advanceId}`}>
                    <td className="num">W{r.week}</td>
                    <td>{names[r.borrowerId] ?? r.borrowerId}</td>
                    <td>{r.reason === "late-payment" ? "Customer payments settled late" : "Wallet could not cover the charge"}</td>
                    <td className="r num">{moneyIn(r.amount, r.currency ?? ccy[r.borrowerId])}</td>
                    <td className="r num">{moneyIn(r.collected, r.currency ?? ccy[r.borrowerId])}</td>
                    <td>
                      {r.settledWeek ? <span className="pill pill-good">Cleared W{r.settledWeek}</span> : <span className="pill pill-warn">Open</span>}
                    </td>
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
            <h2 className="card-title">Decisions</h2>
            <p className="card-sub">What the agent decided, and why.</p>
          </div>
        </div>
        <ol className="run-decisions">
          {run.decisions.map((d, i) => (
            <li key={i}>
              <div className="run-decision-top">
                <span className="muted num">W{d.week}</span>
                <strong>{names[d.borrowerId] ?? d.borrowerId}</strong>
                <span className={`pill ${d.type === "health-review" ? "pill-critical" : "pill-accent"}`}>
                  {d.type === "health-review" ? "Health review" : d.type === "commitment" && d.chosen === "decline" ? "Promise withdrawn" : optionLabel[d.chosen ?? "decline"]}
                </span>
                {d.approval?.required && <span className="pill">{d.approval.approved ? `approved by ${d.approval.by}` : `rejected by ${d.approval.by}`}</span>}
                <span className="muted">decided by {d.decidedBy === "claude" ? "Claude" : "policy rules"}</span>
              </div>
              <p className="secondary">{d.memo}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
