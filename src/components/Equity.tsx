export default function Equity({ points, height = 160 }: { points: { time: number; r: number }[]; height?: number }) {
  if (points.length < 2) return <div className="empty">Not enough trades for a curve</div>;
  const W = 700, H = height, pad = 6;
  const ys = [0, ...points.map((p) => p.r)];
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - lo) / span) * (H - pad * 2);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join(" ");
  const last = points[points.length - 1].r;
  const col = last >= 0 ? "#19c37d" : "#ff4d5e";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height }} role="img" aria-label="Equity curve in R">
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--border2)" strokeDasharray="4 4" />
      <path d={`${d} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={col} fillOpacity={0.1} />
      <path d={d} fill="none" stroke={col} strokeWidth={2} />
      <text x={W - 4} y={12} textAnchor="end" fontSize={11} fill={col}>{last >= 0 ? "+" : ""}{last.toFixed(1)}R</text>
    </svg>
  );
}
