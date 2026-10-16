import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { DecisionRecord } from "../../../src/ledger";
import { defaultParams, type ScenarioParams } from "../../../src/sim/scenario";
import { ThemeToggle, Wordmark } from "../components/Brand";
import { CashChart } from "../components/CashChart";
import { OptionBars } from "../components/OptionBars";
import { Sparkline } from "../components/Sparkline";
import { Check, TierBadge } from "../components/Status";
import { borrowerSector, money, moneyCompact, optionLabel, pct } from "../lib/format";
import { TOTAL_WEEKS, useLiveSimulation, type PendingApproval, type WeekSnap } from "../lib/sim";
import { storyBeats } from "../lib/story";

const NAMES: Record<string, string> = { kopi: "Kopi Roasters", nimbus: "Nimbus Apparel", ledgerly: "Ledgerly SaaS" };

export function Console() {
  const [params, setParams] = useState<ScenarioParams>(defaultParams);
  const [autoApprove, setAutoApprove] = useState(false);
  const sim = useLiveSimulation(params, autoApprove);
  const [selected, setSelected] = useState<number | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");

  const beats = useMemo(() => storyBeats(sim.decisions, sim.events, { allDecisions: true }), [sim.decisions, sim.events]);
  // Follow the newest decision while the run is playing.
  useEffect(() => {
    if (sim.decisions.length) setSelected(sim.decisions.length - 1);
    else setSelected(null);
  }, [sim.decisions.length]);

  const latest = sim.latest;
  const prev = sim.snaps.at(-2);
  const decision = selected != null ? sim.decisions[selected] : undefined;
  const week = sim.snaps.length;

  return (
    <div className="console">
      <header className="topbar">
        <div className="topbar-inner">
          <Wordmark />
          <span className="topbar-sep" aria-hidden="true" />
          <div className="topbar-title">
            <strong>Console</strong>
            <span className="muted">Demo portfolio · 3 borrowers · mock bank</span>
          </div>
          <div className="topbar-actions">
            <ThemeToggle />
            <Link to="/" className="btn btn-ghost btn-sm">
              Overview
            </Link>
          </div>
        </div>
      </header>

      <div className="controls" role="toolbar" aria-label="Simulation controls">
        <div className="controls-inner">
          <div className="transport">
            {sim.done ? (
              <button
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  await sim.reset();
                  sim.play();
                }}
              >
                <PlayIcon /> Run again
              </button>
            ) : sim.playing ? (
              <button className="btn btn-primary btn-sm" onClick={sim.pause}>
                <PauseIcon /> Pause
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={sim.play} disabled={sim.done || !!sim.pending}>
                <PlayIcon /> {week === 0 ? "Run" : "Resume"}
              </button>
            )}
            <button className="btn btn-sm" onClick={() => void sim.step()} disabled={sim.done || sim.busy || sim.playing}>
              Step week
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => void sim.reset()}>
              Reset
            </button>
          </div>
          <WeekProgress week={week} busy={sim.busy} />
          <label className="switch">
            <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} />
            <span className="switch-track" aria-hidden="true">
              <span className="switch-thumb" />
            </span>
            Auto-approve
          </label>
        </div>
      </div>

      <main className="console-grid">
        <div className="console-main">
          <section className="kpis" aria-label="Portfolio at a glance">
            <Kpi label="Platform cash" value={money(latest?.cash ?? 0)} delta={prev && latest ? latest.cash - prev.cash : undefined} hero />
            <Kpi
              label="Headroom over floor"
              value={money((latest?.cash ?? 0) - (latest?.floor ?? 0))}
              note={latest?.floorHeld === false ? "Below floor" : `Floor ${moneyCompact(latest?.floor ?? 0)}`}
              tone={latest && latest.cash - latest.floor < latest.floor * 0.1 ? "tight" : undefined}
            />
            <Kpi label="Book outstanding" value={money(latest?.outstanding ?? 0)} note={`${money(latest?.committed ?? 0)} committed`} />
            <Kpi
              label="Collected to date"
              value={money(latest?.collectedToDate ?? 0)}
              note={
                <span className={`recon ${latest?.reconciled === false ? "is-bad" : ""}`}>
                  <Check size={12} /> {week === 0 ? "Ledger ready" : `Reconciled · W${week}`}
                </span>
              }
            />
          </section>

          <section className="card panel">
            <div className="card-header">
              <div>
                <h2 className="card-title">Platform cash vs reserve floor</h2>
                <p className="card-sub">Numbered markers are decisions and incidents. Select one to inspect it.</p>
              </div>
              <div className="seg" role="tablist" aria-label="View">
                <button role="tab" aria-selected={view === "chart"} className={view === "chart" ? "is-on" : ""} onClick={() => setView("chart")}>
                  Chart
                </button>
                <button role="tab" aria-selected={view === "table"} className={view === "table" ? "is-on" : ""} onClick={() => setView("table")}>
                  Table
                </button>
              </div>
            </div>
            <div className="panel-body">
              {view === "chart" && latest ? (
                <CashChart
                  snaps={sim.snaps}
                  openingCash={sim.openingCash}
                  floor={latest.floor}
                  markers={beats}
                  activeMarker={beats.find((b) => b.decisionIndex === selected)?.n ?? null}
                  onMarker={(m) => {
                    const b = beats.find((x) => x.n === m.n);
                    if (b?.decisionIndex != null) setSelected(b.decisionIndex);
                  }}
                  height={300}
                  label={`Platform cash across ${week} simulated weeks against a ${moneyCompact(latest.floor)} reserve floor.`}
                />
              ) : (
                <WeekTable snaps={sim.snaps} />
              )}
            </div>
          </section>

          <DecisionPanel decision={decision} floor={latest?.floor ?? 0} week={week} decisions={sim.decisions} selected={selected} onSelect={setSelected} />
        </div>

        <aside className="console-side">
          <WhatIf params={params} onChange={setParams} />
          <Borrowers snap={latest} />
          <Activity events={sim.events} />
        </aside>
      </main>

      {sim.pending && <ApprovalDialog pending={sim.pending} floor={latest?.floor ?? 0} />}
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 1.8v8.4L10 6z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2.5" y="2" width="2.4" height="8" rx="0.8" fill="currentColor" />
      <rect x="7.1" y="2" width="2.4" height="8" rx="0.8" fill="currentColor" />
    </svg>
  );
}

function WeekProgress({ week, busy }: { week: number; busy: boolean }) {
  return (
    <div className="progress" aria-label={`Week ${week} of ${TOTAL_WEEKS}`}>
      <span className="progress-label">
        <span className="num">Week {week}</span>
        <span className="muted"> / {TOTAL_WEEKS}</span>
      </span>
      <span className="progress-cells" aria-hidden="true">
        {Array.from({ length: TOTAL_WEEKS }, (_, i) => (
          <span key={i} className={`cell${i < week ? " is-done" : ""}${busy && i === week ? " is-running" : ""}`} />
        ))}
      </span>
    </div>
  );
}

function Kpi({ label, value, note, delta, hero, tone }: { label: string; value: string; note?: React.ReactNode; delta?: number; hero?: boolean; tone?: "tight" }) {
  return (
    <div className={`kpi card${hero ? " kpi-hero" : ""}${tone === "tight" ? " is-tight" : ""}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-note">
        {delta != null ? (
          <span className={delta >= 0 ? "delta-up" : "delta-down"}>
            {delta >= 0 ? "▲" : "▼"} {money(Math.abs(delta))} <span className="muted">vs last week</span>
          </span>
        ) : (
          note
        )}
      </div>
    </div>
  );
}

function WeekTable({ snaps }: { snaps: WeekSnap[] }) {
  if (!snaps.length) return <p className="empty">No weeks run yet.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Week</th>
            <th className="r">Cash</th>
            <th className="r">Headroom</th>
            <th className="r">Committed</th>
            <th className="r">Outstanding</th>
            <th>Ledger</th>
          </tr>
        </thead>
        <tbody>
          {snaps.map((s) => (
            <tr key={s.week}>
              <td>W{s.week}</td>
              <td className="r num">{money(s.cash)}</td>
              <td className="r num">{money(s.cash - s.floor)}</td>
              <td className="r num">{money(s.committed)}</td>
              <td className="r num">{money(s.outstanding)}</td>
              <td>{s.reconciled ? "Reconciled" : "Mismatch"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DecisionPanel({
  decision,
  floor,
  week,
  decisions,
  selected,
  onSelect,
}: {
  decision?: DecisionRecord;
  floor: number;
  week: number;
  decisions: DecisionRecord[];
  selected: number | null;
  onSelect: (i: number) => void;
}) {
  return (
    <section className="card panel">
      <div className="card-header">
        <div>
          <h2 className="card-title">Decisions</h2>
          <p className="card-sub">Every request, every option considered, and why.</p>
        </div>
      </div>
      {decisions.length > 0 && (
        <div className="decision-tabs" role="tablist" aria-label="Decision log">
          {decisions.map((d, i) => (
            <button key={i} role="tab" aria-selected={selected === i} className={`dtab${selected === i ? " is-on" : ""}`} onClick={() => onSelect(i)}>
              <span className="muted num">W{d.week}</span>
              <span>{NAMES[d.borrowerId]}</span>
              <span className={`dtab-dot dot-${d.type === "health-review" ? "stress" : d.chosen === "decline" ? "muted" : "accent"}`} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      <div className="panel-body">
        {!decision ? (
          <div className="empty">
            <strong>{week === 0 ? "Nothing decided yet." : "No requests so far."}</strong>
            <span>The first advance request arrives in week 3. Press Run, or step a week at a time.</span>
          </div>
        ) : decision.type === "health-review" ? (
          <div className="decision-detail">
            <div className="decision-meta">
              <TierBadge tier="stressed" />
              <span className="muted">Week {decision.week} · health review · rules</span>
            </div>
            <p className="decision-memo">{decision.memo}</p>
          </div>
        ) : (
          <div className="decision-detail">
            <div className="decision-meta">
              <span className="pill pill-accent">{optionLabel[decision.chosen ?? "decline"]}</span>
              <span className="muted">
                Week {decision.week} · {NAMES[decision.borrowerId]} asked for {money((decision.inputs.request as { amount: number }).amount)} · decided by{" "}
                {decision.decidedBy === "claude" ? "Claude" : "policy rules"}
              </span>
              {decision.approval?.required && (
                <span className={`pill ${decision.approval.approved ? "pill-good" : "pill-critical"}`}>
                  {decision.approval.approved ? `Approved by ${decision.approval.by}` : `Rejected by ${decision.approval.by}`}
                </span>
              )}
            </div>
            {decision.options && <OptionBars options={decision.options} chosen={decision.chosen} floor={floor} />}
            <p className="decision-memo">{decision.memo}</p>
          </div>
        )}
      </div>
    </section>
  );
}

function WhatIf({ params, onChange }: { params: ScenarioParams; onChange: (p: ScenarioParams) => void }) {
  const set = (patch: Partial<ScenarioParams>) => onChange({ ...params, ...patch });
  const isDefault = JSON.stringify(params) === JSON.stringify(defaultParams);
  return (
    <section className="card side-card">
      <div className="side-head">
        <h2 className="card-title">What if…</h2>
        <button className="btn btn-ghost btn-sm" onClick={() => onChange(defaultParams)} disabled={isDefault}>
          Defaults
        </button>
      </div>
      <p className="card-sub">Changing a scenario restarts the run.</p>
      <div className="sliders">
        <Slider
          label="Nimbus revenue shock"
          value={Math.round(params.shockPct * 100)}
          display={`−${Math.round(params.shockPct * 100)}%`}
          min={0}
          max={85}
          step={5}
          onChange={(v) => set({ shockPct: v / 100 })}
        />
        <Slider label="Shock lands in" value={params.shockWeek} display={`Week ${params.shockWeek}`} min={3} max={10} step={1} onChange={(v) => set({ shockWeek: v })} />
        <Slider
          label="Reserve floor"
          value={params.reserveFloorDollars}
          display={money(params.reserveFloorDollars * 100)}
          min={10_000}
          max={50_000}
          step={5_000}
          onChange={(v) => set({ reserveFloorDollars: v })}
        />
        <Slider
          label="Kopi weekly decline"
          value={Math.round(params.kopiDecline * 100)}
          display={`${Math.round(params.kopiDecline * 100)}% / wk`}
          min={0}
          max={8}
          step={1}
          onChange={(v) => set({ kopiDecline: v / 100 })}
        />
      </div>
    </section>
  );
}

function Slider({ label, value, display, min, max, step, onChange }: { label: string; value: number; display: string; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const fill = ((local - min) / (max - min)) * 100;
  return (
    <label className="slider">
      <span className="slider-top">
        <span>{label}</span>
        <span className="num">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        style={{ "--fill": `${fill}%` } as React.CSSProperties}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={() => local !== value && onChange(local)}
        onKeyUp={() => local !== value && onChange(local)}
      />
    </label>
  );
}

function Borrowers({ snap }: { snap: WeekSnap | null }) {
  return (
    <section className="card side-card">
      <div className="side-head">
        <h2 className="card-title">Borrowers</h2>
      </div>
      <ul className="blist">
        {snap?.borrowers.map((b) => (
          <li key={b.id}>
            <div className="blist-top">
              <div>
                <div className="blist-name">{b.name}</div>
                <div className="card-sub">{borrowerSector[b.id]}</div>
              </div>
              <TierBadge tier={b.tier} />
            </div>
            <div className="blist-bottom">
              <Sparkline values={b.revenue} width={120} height={32} label={`${b.name} weekly revenue`} />
              <dl>
                <div>
                  <dt>Owed</dt>
                  <dd className="num">{money(b.outstanding)}</dd>
                </div>
                <div>
                  <dt>Holdback</dt>
                  <dd className="num">{pct(b.holdbackBps)}</dd>
                </div>
              </dl>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Activity({ events }: { events: { week: number; level: "info" | "warn"; text: string }[] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [events.length]);
  return (
    <section className="card side-card">
      <div className="side-head">
        <h2 className="card-title">Activity</h2>
        <span className="muted num">{events.length}</span>
      </div>
      {events.length === 0 ? (
        <p className="empty empty-sm">Events appear here as the agent works.</p>
      ) : (
        <ol className="feed" ref={ref}>
          {events.map((e, i) => (
            <li key={i} className={e.level === "warn" ? "is-warn" : ""}>
              <span className="feed-week num">W{e.week}</span>
              <span className="feed-text">{e.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ApprovalDialog({ pending, floor }: { pending: PendingApproval; floor: number }) {
  const approveRef = useRef<HTMLButtonElement>(null);
  useEffect(() => approveRef.current?.focus(), []);
  const { record, option } = pending;
  const name = NAMES[record.borrowerId];
  const reason = option.reallocations.length
    ? "Capital is being moved away from another borrower's pending advance."
    : `The amount is above the ${money(2_000_000)} approval line.`;
  return (
    <div className="scrim" role="presentation">
      <div className="dialog card" role="dialog" aria-modal="true" aria-labelledby="approval-title">
        <div className="dialog-head">
          <span className="eyebrow">Approval needed · week {record.week}</span>
          <h2 id="approval-title" className="dialog-title">
            {optionLabel[option.kind]}: {money(option.amount)} to {name}
          </h2>
          <p className="card-sub">{reason}</p>
        </div>
        <div className="dialog-body">
          {record.options && <OptionBars options={record.options} chosen={option.kind} floor={floor} compact />}
          <p className="decision-memo">{record.memo}</p>
        </div>
        <div className="dialog-actions">
          <button className="btn" onClick={() => pending.resolve(false)}>
            Reject
          </button>
          <button className="btn btn-accent" ref={approveRef} onClick={() => pending.resolve(true)}>
            Approve and execute
          </button>
        </div>
      </div>
    </div>
  );
}
