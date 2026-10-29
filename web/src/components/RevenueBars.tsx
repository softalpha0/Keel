import { useState } from "react";
import type { Tier } from "../../../src/domain";
import { moneyCompact, money } from "../lib/format";
import { useWidth } from "../lib/hooks";
import { TierIcon } from "./Status";

const TIER_LABEL: Record<Tier | "new", string> = { healthy: "Healthy", watch: "Watch", stressed: "Stressed", new: "New" };

/**
 * Weekly revenue as bars, one series in the brand colour, with the health tier for each week
 * shown underneath as icon + label (never colour alone).
 */
export function RevenueBars({ weeks, height = 220, label }: { weeks: { week: number; revenue: number; tier: Tier | "new" }[]; height?: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 44, r: 8, t: 12, b: 24 };
  const max = Math.max(1, ...weeks.map((w) => w.revenue)) * 1.12;
  const step = width > 0 ? (width - pad.l - pad.r) / Math.max(1, weeks.length) : 0;
  const barW = Math.max(6, Math.min(36, step * 0.56));
  const y = (v: number) => pad.t + (height - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, 0.5, 1].map((f) => (max / 1.12) * f);
  const h = hover != null ? weeks[hover] : undefined;

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--hairline)" />
              <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="axis">
                {moneyCompact(t)}
              </text>
            </g>
          ))}
          {weeks.map((w, i) => {
            const cx = pad.l + step * i + step / 2;
            return (
              <g key={w.week} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={cx - step / 2} y={pad.t} width={step} height={height - pad.t - pad.b} fill="transparent" />
                <rect
                  x={cx - barW / 2}
                  y={y(w.revenue)}
                  width={barW}
                  height={Math.max(0, height - pad.b - y(w.revenue))}
                  rx={3}
                  fill="var(--accent)"
                  opacity={hover == null || hover === i ? 0.9 : 0.4}
                />
                <text x={cx} y={height - 6} textAnchor="middle" className="axis">
                  W{w.week}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {h && (
        <div className="tooltip tooltip-stack" style={{ left: Math.min(Math.max(pad.l + step * hover! + step / 2, 70), width - 70), top: y(h.revenue) - 12 }}>
          <strong>Week {h.week}</strong>
          <span>{money(h.revenue)} sales</span>
          <span className={`tier tier-${h.tier}`}>
            <TierIcon tier={h.tier} /> {TIER_LABEL[h.tier]}
          </span>
        </div>
      )}
      <ol className="tier-strip" style={{ paddingLeft: pad.l, paddingRight: pad.r }} aria-label="Health tier by week">
        {weeks.map((w) => (
          <li key={w.week} className={`tier-cell tier-${w.tier}`} title={`Week ${w.week}: ${TIER_LABEL[w.tier]}`}>
            <TierIcon tier={w.tier} />
            <span>{TIER_LABEL[w.tier]}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
