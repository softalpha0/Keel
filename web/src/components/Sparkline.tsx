interface Props {
  values: number[];
  /** Fixed number of slots so sparklines line up across cards. */
  slots?: number;
  width?: number;
  height?: number;
  label: string;
}

/** Weekly revenue trend: one recessive line, the latest week marked. */
export function Sparkline({ values, slots = 10, width = 132, height = 36, label }: Props) {
  if (values.length === 0) {
    return (
      <svg width={width} height={height} role="img" aria-label={`${label}: no data yet`}>
        <line x1={0} x2={width} y1={height - 1} y2={height - 1} stroke="var(--hairline)" />
      </svg>
    );
  }
  const max = Math.max(...values) * 1.1;
  const pad = 4;
  const x = (i: number) => pad + (i / Math.max(1, slots - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (height - pad * 2) * (1 - v / max);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const li = values.length - 1;
  return (
    <svg width={width} height={height} role="img" aria-label={`${label}: latest ${values[li]}`}>
      <line x1={0} x2={width} y1={height - 1} y2={height - 1} stroke="var(--hairline)" />
      <path d={d} fill="none" stroke="var(--ink-2)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(li)} cy={y(values[li]!)} r={3.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
    </svg>
  );
}
