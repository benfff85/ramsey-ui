import { useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import type { ProgressionPointDto } from '../types';
import { analyzeIls, epochSeries } from '../ils';
import { Card } from './Card';

const fmtNum = (n: number) => n.toLocaleString('en-US');

/**
 * Clique count on an OFFSET-LOG y-axis, one colored series per kick-epoch, each re-based
 * to x=0 (stages since that epoch began) so the descents OVERLAY on a common left edge.
 * Instead of a plain log axis (where the whole interesting near-min band sits within ~1%
 * of the floor and collapses to a sliver at the bottom), we log-scale (value − baseline)
 * with the baseline just below the floor — this stretches the near-min region across a
 * large share of the axis to expose the kick floors, while the tall kick spikes stay
 * on-screen at the top. A plain campaign is just one "initial" series. Click a legend
 * entry to isolate that series (the rest dim) since near the floor the colors crowd.
 */
export function CliqueProgressionChart({ progression }: { progression: ProgressionPointDto[] }) {
  const [active, setActive] = useState<string | null>(null);
  const series = epochSeries(progression);
  const ils = analyzeIls(progression);
  if (!series) return null;

  const counts = series.data.flatMap((row) =>
    series.epochs.map((e) => row[e.key]).filter((v): v is number => v != null));
  const lo = counts.length ? Math.min(...counts) : 1;
  const hi = counts.length ? Math.max(...counts) : 10;

  // Offset-log: subtract a baseline just below the floor, then log-scale. The smaller the
  // offset (baseline closer to the floor), the more aggressively the near-min band spreads.
  const offset = Math.max(1, Math.round(lo * 0.001)); // ~26 at a ~25,840 floor
  const baseline = lo - offset;
  const shift = (v: number) => v - baseline;
  const data = series.data.map((row) => {
    const out: Record<string, number> = { x: row.x };
    for (const e of series.epochs) if (row[e.key] != null) out[e.key] = shift(row[e.key]);
    return out;
  });
  const domain: [number, number] = [Math.max(1, Math.floor(offset * 0.9)), Math.ceil(shift(hi) * 1.06)];
  const yFmt = (v: number) => fmtNum(Math.round(v + baseline));

  const multi = series.epochs.length > 1;
  // A highlight only makes sense if the active key is still present; otherwise treat as none.
  const activeKey = active && series.epochs.some((e) => e.key === active) ? active : null;
  const toggle = (key: string) => setActive((cur) => (cur === key ? null : key));
  // Draw the highlighted series last so it sits on top of the others.
  const drawOrder = activeKey
    ? [...series.epochs].sort((a, b) => Number(a.key === activeKey) - Number(b.key === activeKey))
    : series.epochs;

  const title = multi
    ? <>Clique count per stage <span className="dim">· offset-log · {series.epochs.length - 1} kick{series.epochs.length > 2 ? 's' : ''}</span></>
    : <>Clique count per stage <span className="dim">· offset-log</span></>;

  return (
    <Card title={title}
          action={multi ? <span className="chart-note">click a series to isolate</span> : undefined}>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 14, bottom: 0, left: 4 }}>
          <CartesianGrid stroke="var(--border-soft)" vertical={false} />
          <XAxis dataKey="x" type="number" domain={[0, series.xMax]} allowDataOverflow
                 stroke="var(--faint)" tickLine={false} minTickGap={40} fontSize={11}
                 tickFormatter={fmtNum}
                 label={{ value: 'stages since kick', position: 'insideBottom', offset: -2,
                   fill: 'var(--faint)', fontSize: 10, fontFamily: 'var(--font-mono)' }} />
          <YAxis scale="log" domain={domain} allowDataOverflow tickFormatter={yFmt}
                 stroke="var(--faint)" tickLine={false} axisLine={false} width={64} fontSize={11} />
          <Tooltip
            contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--border)',
              borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            labelStyle={{ color: 'var(--muted)' }}
            formatter={(v: number) => [yFmt(v), 'cliques']} labelFormatter={(s) => `+${fmtNum(Number(s))} stages`} />
          {ils && (
            <ReferenceLine y={shift(ils.incumbent)} stroke="var(--accent)" strokeDasharray="4 4" strokeOpacity={0.8}
              label={{ value: `best ${fmtNum(ils.incumbent)}`, position: 'insideBottomLeft',
                fill: 'var(--accent)', fontSize: 10, fontFamily: 'var(--font-mono)' }} />
          )}
          {drawOrder.map((e) => {
            const isActive = activeKey === e.key;
            const dim = activeKey != null && !isActive;
            return (
              <Line key={e.key} type="monotone" dataKey={e.key} stroke={e.color}
                    strokeWidth={isActive ? 2.75 : 1.5} strokeOpacity={dim ? 0.12 : 1}
                    dot={false} isAnimationActive={false} connectNulls name={e.label} />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
      {multi && (
        <div className="overlay-legend">
          {series.epochs.map((e) => {
            const cls = 'overlay-legend__item overlay-legend__item--btn'
              + (activeKey && activeKey !== e.key ? ' is-dim' : '')
              + (activeKey === e.key ? ' is-active' : '');
            return (
              <button key={e.key} type="button" className={cls} aria-pressed={activeKey === e.key}
                      onClick={() => toggle(e.key)}>
                <span className="overlay-legend__swatch" style={{ background: e.color }} />
                {e.label} <span className="dim">· floor {fmtNum(e.floor)}</span>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
