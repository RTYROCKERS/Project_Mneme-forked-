import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { forgettingCurve, strengthMeta, pct } from '@/lib/mnemeUi';

/**
 * The forgetting curve for a single memory — the visual that makes Mneme's
 * thesis legible: knowledge decays, and a well-timed nudge resets it. A dashed
 * line marks "now"; the shaded area is current retention.
 */
export function RetentionCurve({ memory, height = 160 }) {
  if (!memory) return null;
  const meta = strengthMeta(memory.strength);
  const { data, now } = forgettingCurve(memory.stability_days, memory.days_since_review);
  const nowDay = data.reduce(
    (p, c) => (Math.abs(c.day - now) < Math.abs(p.day - now) ? c : p),
    data[0]
  ).day;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-sm text-[var(--text-primary)] truncate pr-3">{memory.card}</p>
        <span className="text-sm font-semibold shrink-0" style={{ color: meta.hex }}>
          {pct(memory.retrievability)}%
        </span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 6, right: 8, left: -24, bottom: 0 }}>
          <defs>
            <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={meta.hex} stopOpacity={0.35} />
              <stop offset="100%" stopColor={meta.hex} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="day"
            tick={{ fontSize: 10, fill: '#8b9cb5' }}
            tickFormatter={(d) => `${d}d`}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#8b9cb5' }}
            domain={[0, 1]}
            ticks={[0, 0.5, 1]}
            tickFormatter={(v) => `${Math.round(v * 100)}%`}
          />
          <Tooltip
            contentStyle={{ background: '#1e2536', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', fontSize: '12px' }}
            labelStyle={{ color: '#e8eaf0' }}
            itemStyle={{ color: meta.hex }}
            formatter={(v) => [`${Math.round(v * 100)}% recall`, 'retention']}
            labelFormatter={(d) => `day ${d}`}
          />
          <ReferenceLine
            x={nowDay}
            stroke="#e8eaf0"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
            label={{ value: 'now', fill: '#8b9cb5', fontSize: 10, position: 'top' }}
          />
          <Area type="monotone" dataKey="retention" stroke={meta.hex} strokeWidth={2} fill="url(#curveFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
