import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Sparkline } from "../components/Sparkline";
import { addPortalRequest, loadParams } from "../lib/workspace";
import { Mark, ThemeToggle } from "../components/Brand";
import { money, moneyIn, pct } from "../lib/format";
import { useDemoRun, type RunResult } from "../lib/sim";
import { NotFound } from "./NotFound";

const IDS = ["kopi", "nimbus", "ledgerly"];

/**
 * The borrower's side: what a merchant on the platform sees about their advance.
 * Same run as the credit desk, told in the merchant's terms.
 */
export function PortalPage() {
  const { id = "" } = useParams();
  // Same settings and portal requests as the credit desk, so both tell the same story.
  const [params, setParams] = useState(loadParams);
  const run = useDemoRun(params);
  if (!IDS.includes(id)) return <NotFound />;
  return (
    <div className="portal">
      <header className="portal-top">
        <div className="portal-brand">
          <Mark size={22} />
          <span>
            <strong>Keel Capital</strong>
            <span className="muted"> · for platform merchants</span>
          </span>
        </div>
        <div className="portal-actions">
          <ThemeToggle />
          <Link to={`/borrowers/${id}`} className="btn btn-ghost btn-sm">
            Operator view
          </Link>
        </div>
      </header>
      <div className="portal-demo">
        <span className="muted">Demo: viewing as</span>
        {IDS.map((b) => (
          <Link key={b} to={`/portal/${b}`} className={`portal-as${b === id ? " is-on" : ""}`}>
            {run?.borrowers.find((x) => x.id === b)?.name ?? b}
          </Link>
        ))}
      </div>
      <main className="portal-main">
        {run ? (
          <Portal
            run={run}
            id={id}
            onRequest={(amountDollars) => {
              addPortalRequest({ borrowerId: id, amountDollars, week: run.snaps.length });
              setParams(loadParams());
            }}
          />
        ) : null}
      </main>
    </div>
  );
}

type Note = { week: number; kind: "in" | "out" | "info" | "warn" | "ok"; title: string; body?: string; meta?: string };

/** Everything that happened to this merchant, newest first, in their words. */
function notifications(run: RunResult, id: string): Note[] {
  const { ledger } = run;
  const notes: Note[] = [];
  for (const r of ledger.receipts.filter((x) => x.borrowerId === id && x.status === "settled")) {
    if (r.kind === "disburse") notes.push({ week: r.week, kind: "in", title: `${money(r.amount)} advance paid to your Airwallex account`, meta: r.transferId });
    else
      notes.push({
        week: r.week,
        kind: "out",
        title: `Repayment of ${r.fx ? moneyIn(r.fx.localAmount, r.fx.currency) : money(r.amount)} taken${r.idempotencyKey.startsWith("catchup:") ? " (catch-up)" : ""}`,
        meta: r.transferId,
      });
  }
  for (const d of ledger.decisions.filter((x) => x.borrowerId === id)) {
    const req = d.inputs.request as { id: string; amount: number } | undefined;
    const chosen = d.options?.find((o) => o.kind === d.chosen);
    if (d.type === "health-review") notes.push({ week: d.week, kind: "warn", title: "New funding paused while your sales recover", body: "What you owe doesn't change: repayments stay a share of sales, so they shrink when sales do." });
    else if (d.type === "commitment" && d.chosen === "decline") notes.push({ week: d.week, kind: "warn", title: "Your pending top-up wasn't sent", body: "We re-checked it before paying out and your sales had softened, so it would have stretched you." });
    else if (d.type === "advance-request" && req) {
      const fromPortal = req.id.startsWith("req_portal");
      const title =
        d.chosen === "decline"
          ? `We couldn't approve your request for ${money(req.amount)}`
          : d.chosen === "delay"
            ? `Your request for ${money(req.amount)} is scheduled for week ${chosen?.executeWeek}`
            : `Request for ${money(req.amount)} approved${chosen && chosen.amount < req.amount ? `: ${money(chosen.amount)} now` : ""}`;
      notes.push({ week: d.week, kind: d.chosen === "decline" ? "warn" : "ok", title, body: (fromPortal ? "Sent from this portal. " : "") + d.memo.split(". ")[0] + "." });
    }
  }
  for (const rc of ledger.receivables.filter((x) => x.borrowerId === id && x.reason === "late-payment"))
    notes.push({ week: rc.week, kind: "info", title: "Some of your customers paid late", body: `We only took our share of money that arrived${rc.settledWeek ? `, and collected the rest in week ${rc.settledWeek} when it landed` : ""}. No fee, no penalty.` });
  const order = { ok: 0, warn: 1, info: 2, in: 3, out: 4 };
  return notes.sort((a, b) => b.week - a.week || order[a.kind] - order[b.kind]);
}

function Portal({ run, id, onRequest }: { run: RunResult; id: string; onRequest: (amountDollars: number) => void }) {
  const b = run.borrowers.find((x) => x.id === id)!;
  const end = run.snaps.at(-1)!.borrowers.find((x) => x.id === id)!;
  const { ledger } = run;
  const ccy = b.currency ?? "USD";
  const advances = ledger.advances.filter((a) => a.borrowerId === id);
  const total = advances.reduce((s, a) => s + a.principal + a.fee, 0);
  const owed = advances.reduce((s, a) => s + a.outstanding, 0);
  const repaid = total - owed;
  const progress = total ? repaid / total : 0;
  const limit = run.capacity[id] ?? 0;
  const lastWeek = run.snaps.length;
  const notes = notifications(run, id);
  const [showAll, setShowAll] = useState(false);
  const salesNow = end.revenue.at(-1) ?? 0;
  const salesPrev = end.revenue.at(-2) ?? 0;

  // A weekly statement: sales, what was repaid, and anything that happened that week.
  const weeks = run.snaps
    .map((s) => {
      const w = s.week;
      const sales = s.borrowers.find((x) => x.id === id)!.revenue.at(-1) ?? 0;
      const paid = ledger.receipts.filter((r) => r.borrowerId === id && r.kind === "collect" && r.status === "settled" && r.week === w);
      const received = ledger.receipts.filter((r) => r.borrowerId === id && r.kind === "disburse" && r.status === "settled" && r.week === w);
      return { w, sales, paid, received };
    })
    .reverse();

  return (
    <div className="portal-grid">
      <section className="portal-hello">
        <p className="eyebrow">Week {lastWeek}</p>
        <h1 className="h2">Hi, {b.name}.</h1>
      </section>

      <section className="card portal-balance">
        <div className="pb-top">
          <div>
            <div className="kpi-label">Left to repay</div>
            <div className="pb-amount">{money(owed)}</div>
          </div>
          <div className="pb-rate">
            <div className="kpi-label">Repayment</div>
            <div className="pb-rate-value">{pct(b.holdbackBps)} of sales</div>
          </div>
        </div>
        <div className="pb-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Repaid so far">
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <div className="pb-foot">
          <span>
            {money(repaid)} repaid of {money(total)}
          </span>
          <span className="muted">No fixed due date: a slow week means a smaller repayment.</span>
        </div>
      </section>

      <section className={`card portal-offer ${end.tier === "stressed" ? "is-paused" : ""}`}>
        {end.tier === "stressed" ? (
          <>
            <div className="kpi-label">New funding</div>
            <h2 className="po-title">Paused while your sales recover</h2>
            <p className="secondary">
              Your sales dropped sharply in recent weeks, so we've paused new advances for now. Nothing changes about what you already owe: you keep repaying {pct(b.holdbackBps)} of each
              week's sales, so repayments shrink with your revenue. We'll reopen funding automatically as sales stabilise.
            </p>
          </>
        ) : limit >= 200_000 ? (
          <>
            <div className="kpi-label">Available to you</div>
            <h2 className="po-title">{money(limit)} ready to draw</h2>
            <p className="secondary">Based on your recent sales. Paid out in USD to your Airwallex account, repaid at {pct(b.holdbackBps)} of sales.</p>
            <RequestForm limit={limit} onRequest={onRequest} />
          </>
        ) : (
          <>
            <div className="kpi-label">Available to you</div>
            <h2 className="po-title">No new funding right now</h2>
            <p className="secondary">
              {end.tier === "watch"
                ? "Your sales have softened a little, so your limit is lower while you repay your current advance. It grows again as you repay and as sales pick up."
                : "You're using your full limit. It frees up as you repay."}
            </p>
          </>
        )}
      </section>

      <section className="card portal-sales">
        <div className="kpi-label">Sales this week</div>
        <div className="ps-big num">{money(salesNow)}</div>
        {salesPrev > 0 && (
          <span className={`delta-pill ${salesNow >= salesPrev ? "is-up" : "is-down"}`}>
            {salesNow >= salesPrev ? "▲" : "▼"} {Math.abs(Math.round(((salesNow - salesPrev) / salesPrev) * 100))}% vs last week
          </span>
        )}
        <Sparkline values={end.revenue} width={320} height={56} label={`${b.name} weekly sales`} />
        {end.refundRate !== undefined && <p className="muted ps-note">Refunds and chargebacks: {(end.refundRate * 100).toFixed(1)}% of sales last week.</p>}
      </section>

      <section className="card portal-notices">
        <div className="side-head">
          <div className="kpi-label">Notifications</div>
          <span className="muted num">{notes.length}</span>
        </div>
        <ol className="notes">
          {notes.slice(0, showAll ? undefined : 6).map((n, i) => (
            <li key={i} className={`note note-${n.kind}`}>
              <span className="note-icon" aria-hidden="true">
                {n.kind === "in" ? "↓" : n.kind === "out" ? "↑" : n.kind === "ok" ? "✓" : n.kind === "warn" ? "!" : "i"}
              </span>
              <div>
                <strong>{n.title}</strong>
                {n.body && <p className="secondary">{n.body}</p>}
                <span className="note-meta num">
                  Week {n.week}
                  {n.meta && <> · {n.meta}</>}
                </span>
              </div>
            </li>
          ))}
        </ol>
        {notes.length > 6 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show fewer" : `Show all ${notes.length}`}
          </button>
        )}
      </section>

      <section className="card portal-statement">
        <div className="card-header">
          <div>
            <h2 className="card-title">Statement</h2>
            <p className="card-sub">{ccy !== "USD" ? `Repayments are taken in ${ccy} from your ${ccy} wallet.` : "Every week's sales and repayment."}</p>
          </div>
        </div>
        <ol className="ps-list">
          {weeks.map(({ w, sales, paid, received }) => (
            <li key={w}>
              <span className="ps-week num">W{w}</span>
              <div className="ps-main">
                <span>Sales {money(sales)}</span>
                {received.map((r) => (
                  <span key={r.idempotencyKey} className="ps-in">
                    + {money(r.amount)} advance received
                  </span>
                ))}
              </div>
              <div className="ps-paid num">
                {paid.length ? (
                  paid.map((r) => (
                    <span key={r.idempotencyKey}>
                      − {r.fx ? moneyIn(r.fx.localAmount, r.fx.currency) : money(r.amount)}
                      {r.idempotencyKey.startsWith("catchup:") ? " catch-up" : ""}
                    </span>
                  ))
                ) : (
                  <span className="muted">—</span>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <p className="portal-foot muted">
        This is a demo of what a merchant on the platform would see, from the same simulated run as the <Link to="/desk">credit desk</Link>.
      </p>
    </div>
  );
}

function RequestForm({ limit, onRequest }: { limit: number; onRequest: (amountDollars: number) => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(Math.floor(limit / 100 / 1000) * 1000);
  const [sent, setSent] = useState(false);
  if (sent) return <p className="po-sent">Request sent. Keel decided it in this week's run: see your notifications.</p>;
  if (!open)
    return (
      <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
        Request funds
      </button>
    );
  return (
    <form
      className="po-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (amount < 2_000) return;
        onRequest(amount);
        setSent(true);
      }}
    >
      <label>
        <span className="kpi-label">Amount (USD)</span>
        <input type="number" min={2000} step={500} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
      </label>
      <button className="btn btn-primary btn-sm" disabled={amount < 2_000}>
        Send request
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
        Cancel
      </button>
      <p className="muted po-hint">Keel checks it against your sales and the platform's reserve, the same way it decides every request. It also appears on the platform's credit desk.</p>
    </form>
  );
}
