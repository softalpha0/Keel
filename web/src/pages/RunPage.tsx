import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { RunRecord } from "../../../src/sim/record";
import { ThemeToggle, Wordmark } from "../components/Brand";
import { CashChart } from "../components/CashChart";
import { Check, Cross } from "../components/Status";
import { money, optionLabel } from "../lib/format";
import type { WeekSnap } from "../lib/sim";

type Load = { state: "loading" } | { state: "missing" } | { state: "ready"; run: RunRecord };

export function RunPage() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  useEffect(() => {
    fetch("/runs/latest.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((run: RunRecord) => setLoad({ state: "ready", run }))
      .catch(() => setLoad({ state: "missing" }));
  }, []);

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
            <ThemeToggle />
            <Link to="/console" className="btn btn-ghost btn-sm">
              Console
            </Link>
            <Link to="/" className="btn btn-ghost btn-sm">
              Overview
            </Link>
          </div>
        </div>
      </header>
      <main className="run-main">
        {load.state === "loading" ? null : load.state === "missing" ? <NoRun /> : <Run run={load.run} />}
      </main>
    </div>
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
  const owed = run.receivables.reduce((s, r) => s + r.amount, 0);
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
        </div>
        <h1 className="h2">{live ? "Ten weeks on real sandbox rails." : "Ten weeks on the simulated bank."}</h1>
        <p className="muted run-meta">
          Run <span className="mono">{run.runId}</span> · {new Date(run.startedAt).toLocaleString()} · {money(run.fund.size)} fund · floor{" "}
          {money(run.fund.reserveFloor - offset)} inside the fund
        </p>
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
          <div className="kpi-label">Receivables</div>
          <div className="kpi-value">{money(owed)}</div>
          <div className="kpi-note">{run.receivables.length ? "short wallets, still owed" : "every repayment covered"}</div>
        </div>
        <div className="kpi card">
          <div className="kpi-label">Retries recovered</div>
          <div className="kpi-value">{retried}</div>
          <div className="kpi-note">no duplicate money movement</div>
        </div>
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
                  <td>{m.kind === "disburse" ? "Advance → borrower" : "Repayment → platform"}</td>
                  <td>
                    {names[m.borrowerId] ?? m.borrowerId}
                    <div className="mono muted">{accounts[m.borrowerId]}</div>
                  </td>
                  <td className="r num">{money(m.amount)}</td>
                  <td className="mono">{m.transferId}</td>
                  {live && <td className="mono muted">{m.requestId}</td>}
                  <td>
                    <span className={`pill ${m.status === "settled" ? "pill-good" : "pill-critical"}`}>{m.status === "settled" ? "Settled" : m.status}</span>
                    {m.attempts > 1 && <span className="pill">retried ×{m.attempts - 1}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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
                  {d.type === "health-review" ? "Health review" : optionLabel[d.chosen ?? "decline"]}
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
