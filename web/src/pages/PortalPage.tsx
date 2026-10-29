import { Link, useParams } from "react-router-dom";
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
  const run = useDemoRun();
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
      <main className="portal-main">{run ? <Portal run={run} id={id} /> : null}</main>
    </div>
  );
}

function Portal({ run, id }: { run: RunResult; id: string }) {
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
  const withdrawn = ledger.decisions.find((d) => d.type === "commitment" && d.borrowerId === id && d.chosen === "decline");
  const late = ledger.receivables.find((r) => r.borrowerId === id && r.reason === "late-payment");
  const declined = ledger.decisions.filter((d) => d.type === "advance-request" && d.borrowerId === id && d.chosen === "decline");

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
            <button className="btn btn-primary btn-sm" disabled title="Demo portal">
              Request funds
            </button>
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

      {(withdrawn || late || declined.length > 0) && (
        <section className="card portal-notices">
          <div className="kpi-label">Messages</div>
          <ul>
            {late && (
              <li>
                <strong>Week {late.week}: some of your customers paid late.</strong> We only took our share of the money that arrived, and collected the rest in week {late.settledWeek ?? "?"} when
                it landed. No fee, no penalty.
              </li>
            )}
            {withdrawn && (
              <li>
                <strong>Week {withdrawn.week}: your pending top-up wasn't sent.</strong> We re-checked it before paying out and your sales had softened since it was offered, so taking it now
                would have stretched you. You can request again once sales pick up.
              </li>
            )}
            {declined.map((d) => (
              <li key={d.week}>
                <strong>Week {d.week}: we couldn't approve your request for {money((d.inputs.request as { amount: number }).amount)}.</strong> Your recent sales are well below your usual level,
                and adding to what you owe now would make it harder to recover.
              </li>
            ))}
          </ul>
        </section>
      )}

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
