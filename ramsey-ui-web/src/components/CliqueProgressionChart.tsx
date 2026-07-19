import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import type { ProgressionPointDto } from '../types';
import { Card } from './Card';

const fmtNum = (n: number) => n.toLocaleString('en-US');

/**
 * Best clique count so far (running minimum) over stages. Using the running min
 * rather than the raw per-stage count is what makes this readable under Phase-2
 * perturbation: kicks/re-descents swing the raw count between ~26k and ~72k
 * (a sawtooth that flattens any raw view), while the running min is monotonic —
 * it tracks true progress and a kick that finally beats the floor shows as a
 * clean step down. For a plain descending campaign it equals the descent.
 */
export function CliqueProgressionChart({ progression }: { progression: ProgressionPointDto[] }) {
  const sorted = [...progression].sort((a, b) => a.stageId - b.stageId);
  let best = Infinity;
  const data = sorted.map((p) => {
    if (p.cliqueCount < best) best = p.cliqueCount;
    return { stage: p.stageId, clique: best };
  });
  return (
    <Card title="Best clique count over stages">
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 14, bottom: 0, left: 4 }}>
          <CartesianGrid stroke="var(--border-soft)" vertical={false} />
          <XAxis dataKey="stage" stroke="var(--faint)" tickLine={false} minTickGap={40} fontSize={11} />
          <YAxis tickFormatter={fmtNum} stroke="var(--faint)" tickLine={false} axisLine={false}
                 width={64} fontSize={11} domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--border)',
              borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            labelStyle={{ color: 'var(--muted)' }}
            formatter={(v: number) => [fmtNum(v), 'best']} labelFormatter={(s) => `stage ${s}`} />
          <Line type="monotone" dataKey="clique" stroke="var(--green)" strokeWidth={2}
                dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
