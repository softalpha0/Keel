import { useMemo, useState } from "react";
import { useWidth } from "../lib/hooks";
import { money, moneyCompact } from "../lib/format";
import type { WeekSnap } from "../lib/sim";

export interface ChartMarker {
  week: number;
  /** Short number shown on the marker; explained in a caption list outside the chart. */
  n: number;
  kind: "decision" | "incident" | "stress";
  title: string;
}

interface Props {
  snaps: WeekSnap[];
  openingCash: number;
  floor: number;
  weeks?: number;
  height?: number;
  markers?: ChartMarker[];
  activeMarker?: number | null;
  onMarker?: (m: ChartMarker) => void;
  animate?: boolean;
  label: string;
}

const M = { top: 28, right: 18, bottom: 30, left: 48 };

const niceStep = (max: number) => {
  const raw = max / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
};

/** Platform cash against the reserve floor, week by week. One series plus a threshold. */
export function CashChart({ snaps, openingCash, floor, weeks = 10, height = 320, markers = [], activeMarker, onMarker, animate, label }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const pts = useMemo(() => [{ week: 0, cash: openingCash, committed: 0, floor }, ...snaps], [snaps, openingCash, floor]);
  const yMaxRaw = Math.max(openingCash, ...pts.map((p) => p.cash)) * 1.04;
  const step = niceStep(yMaxRaw);
  const yMax = Math.ceil(yMaxRaw / step) * step;
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step);

  const iw = Math.max(0, width - M.left - M.right);
  const ih = height - M.top - M.bottom;
  const x = (w: number) => M.left + (w / weeks) * iw;
  const y = (v: number) => M.top + ih - (v / yMax) * ih;

  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.week).toFixed(1)},${y(p.cash).toFixed(1)}`).join("");
  const last = pts.at(-1)!;
  const area = `${line}L${x(last.week).toFixed(1)},${y(0)}L${x(0)},${y(0)}Z`;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const w = Math.round(((px - M.left) / iw) * weeks);
    setHover(Math.max(0, Math.min(last.week, w)));
  };

  const hp = hover != null ? pts.find((p) => p.week === hover) : undefined;
  const xLabels = width < 520 ? [0, 2, 4, 6, 8, 10] : Array.from({ length: weeks + 1 }, (_, i) => i);

  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          <g className="grid">
            {ticks.map((t) => (
              <line key={t} x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} />
            ))}
          </g>
          <g className="axis">
            {ticks.map((t) => (
              <text key={t} x={M.left - 10} y={y(t)} dy="0.32em" textAnchor="end">
                {t === 0 ? "$0" : moneyCompact(t)}
              </text>
            ))}
            {xLabels.map((w) => (
              <text key={w} x={x(w)} y={height - 8} textAnchor="middle">
                {w === 0 ? "Start" : `W${w}`}
              </text>
            ))}
          </g>

          {/* The zone the agent may never enter */}
          <rect x={M.left} y={y(floor)} width={iw} height={y(0) - y(floor)} fill="var(--critical-wash)" />
          <line x1={M.left} x2={width - M.right} y1={y(floor)} y2={y(floor)} stroke="var(--critical)" strokeWidth={1.5} />
          <g transform={`translate(${M.left + 8}, ${y(floor) + 16})`}>
            <text textAnchor="start" className="floor-label">
              Reserve floor · {moneyCompact(floor)}
            </text>
          </g>

          <line className="baseline" x1={M.left} x2={width - M.right} y1={y(0)} y2={y(0)} />

          <path d={area} fill="var(--accent-wash)" className={animate ? "chart-fade" : undefined} />
          <path
            d={line}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            pathLength={animate ? 1 : undefined}
            className={animate ? "chart-draw" : undefined}
          />

          <rect
            x={M.left}
            y={M.top}
            width={iw}
            height={ih}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />

          <g pointerEvents="none">
          {hp && (
            <line x1={x(hp.week)} x2={x(hp.week)} y1={M.top - 8} y2={y(0)} stroke="var(--ink-3)" strokeWidth={1} shapeRendering="crispEdges" />
          )}

          {pts.slice(1).map((p) => (
            <circle key={p.week} cx={x(p.week)} cy={y(p.cash)} r={hover === p.week ? 4.5 : 0} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
          ))}
          <circle cx={x(last.week)} cy={y(last.cash)} r={4.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
          </g>

          {markers
            .filter((m) => m.week <= last.week)
            .map((m) => {
              const p = pts.find((q) => q.week === m.week);
              if (!p) return null;
              const cx = x(m.week);
              const cy = y(p.cash) - 22;
              const color = m.kind === "stress" ? "var(--critical)" : m.kind === "incident" ? "var(--ink-2)" : "var(--accent)";
              const active = activeMarker === m.n;
              return (
                <g
                  key={m.n}
                  className={`marker${onMarker ? " is-clickable" : ""}${active ? " is-active" : ""}`}
                  onClick={onMarker ? () => onMarker(m) : undefined}
                  role={onMarker ? "button" : undefined}
                  tabIndex={onMarker ? 0 : undefined}
                  aria-label={`${m.n}. Week ${m.week}: ${m.title}`}
                  onKeyDown={onMarker ? (e) => (e.key === "Enter" || e.key === " ") && onMarker(m) : undefined}
                >
                  <line x1={cx} x2={cx} y1={cy + 9} y2={y(p.cash) - 5} stroke={color} strokeWidth={1} />
                  <circle cx={cx} cy={cy} r={16} fill="transparent" />
                  <circle cx={cx} cy={cy} r={9} fill={active ? color : "var(--surface)"} stroke={color} strokeWidth={1.5} />
                  <text x={cx} y={cy} dy="0.35em" textAnchor="middle" className="marker-n" fill={active ? "var(--surface)" : "var(--ink)"}>
                    {m.n}
                  </text>
                </g>
              );
            })}

        </svg>
      )}
      {hp && width > 0 && (
        <div className="tooltip" style={{ left: Math.min(Math.max(x(hp.week), 96), width - 96), top: y(hp.cash) }}>
          <div className="tooltip-title">{hp.week === 0 ? "Opening balance" : `Week ${hp.week}`}</div>
          <div className="tooltip-row">
            <i className="key-line" style={{ background: "var(--accent)" }} />
            <strong>{money(hp.cash)}</strong>
            <span>platform cash</span>
          </div>
          <div className="tooltip-row">
            <i className="key-line" style={{ background: "var(--critical)" }} />
            <strong>{money(hp.cash - floor)}</strong>
            <span>above floor</span>
          </div>
          {"committed" in hp && hp.week > 0 && (
            <div className="tooltip-row">
              <i className="key-line" style={{ background: "var(--ink-3)" }} />
              <strong>{money(hp.committed)}</strong>
              <span>committed</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
