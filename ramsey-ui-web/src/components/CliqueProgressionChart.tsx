import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import type { ProgressionPointDto } from '../types';
import { analyzeIls, epochSeries } from '../ils';
import { Card } from './Card';

const fmtNum = (n: number) => n.toLocaleString('en-US');

/**
 * Clique count on a LOG y-axis, one colored series per kick-epoch, each re-based to
 * x=0 (stages since that epoch began) so the descents OVERLAY on a common left edge —
 * every kick free-falls from ~3× the floor, and you can compare where each bottoms out
 * relative to the incumbent (dashed reference line). Log scale keeps the ~72k spikes and
 * the ~26k floor both readable. A plain campaign is just one "initial" series.
 */
export function CliqueProgressionChart({ progression }: { progression: ProgressionPointDto[] }) {
  const series = epochSeries(progression);
  const ils = analyzeIls(progression);
  if (!series) return null;

  const counts = series.data.flatMap((row) =>
    series.epochs.map((e) => row[e.key]).filter((v): v is number => v != null));
  const lo = counts.length ? Math.min(...counts) : 1;
  const hi = counts.length ? Math.max(...counts) : 10;
  const domain: [number, number] = [Math.max(1, Math.floor(lo * 0.97)), Math.ceil(hi * 1.06)];

  const multi = series.epochs.length > 1;
  const title = multi
    ? <>Clique count per stage <span className="dim">· log · {series.epochs.length - 1} kick{series.epochs.length > 2 ? 's' : ''}</span></>
    : <>Clique count per stage <span className="dim">· log</span></>;

  return (
    <Card title={title}>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={series.data} margin={{ top: 8, right: 14, bottom: 0, left: 4 }}>
          <CartesianGrid stroke="var(--border-soft)" vertical={false} />
          <XAxis dataKey="x" type="number" domain={[0, series.xMax]} allowDataOverflow
                 stroke="var(--faint)" tickLine={false} minTickGap={40} fontSize={11}
                 tickFormatter={fmtNum}
                 label={{ value: 'stages since kick', position: 'insideBottom', offset: -2,
                   fill: 'var(--faint)', fontSize: 10, fontFamily: 'var(--font-mono)' }} />
          <YAxis scale="log" domain={domain} allowDataOverflow tickFormatter={fmtNum}
                 stroke="var(--faint)" tickLine={false} axisLine={false} width={64} fontSize={11} />
          <Tooltip
            contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--border)',
              borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            labelStyle={{ color: 'var(--muted)' }}
            formatter={(v: number) => [fmtNum(v), 'cliques']} labelFormatter={(s) => `+${fmtNum(Number(s))} stages`} />
          {ils && (
            <ReferenceLine y={ils.incumbent} stroke="var(--accent)" strokeDasharray="4 4" strokeOpacity={0.8}
              label={{ value: `best ${fmtNum(ils.incumbent)}`, position: 'insideBottomLeft',
                fill: 'var(--accent)', fontSize: 10, fontFamily: 'var(--font-mono)' }} />
          )}
          {series.epochs.map((e) => (
            <Line key={e.key} type="monotone" dataKey={e.key} stroke={e.color} strokeWidth={1.5}
                  dot={false} isAnimationActive={false} connectNulls={false} name={e.label} />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {multi && (
        <div className="overlay-legend">
          {series.epochs.map((e) => (
            <span key={e.key} className="overlay-legend__item">
              <span className="overlay-legend__swatch" style={{ background: e.color }} />
              {e.label} <span className="dim">· floor {fmtNum(e.floor)}</span>
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
