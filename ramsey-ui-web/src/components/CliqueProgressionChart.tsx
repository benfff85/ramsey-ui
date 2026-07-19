import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import type { ProgressionPointDto } from '../types';
import { Card } from './Card';

const fmtNum = (n: number) => n.toLocaleString('en-US');

// Clip only perturbation kicks (Phase 2 ILS): a kick spikes the base graph to
// ~3x the floor for one stage, which otherwise flattens the whole descent. Legit
// descents in this search stay within ~1.1x of their floor, so a cap at 1.5x the
// min cleanly separates them: normal campaigns are unclipped (dataMax < cap),
// kicks are clipped out and shown as lines to the top edge.
function clipMax(values: number[]): number {
  if (values.length === 0) return 0;
  const min = Math.min(...values);
  const dataMax = Math.max(...values);
  return Math.min(dataMax, Math.ceil(min * 1.5));
}

export function CliqueProgressionChart({ progression }: { progression: ProgressionPointDto[] }) {
  const data = [...progression].sort((a, b) => a.stageId - b.stageId)
    .map((p) => ({ stage: p.stageId, clique: p.cliqueCount }));
  const yMax = clipMax(data.map((d) => d.clique));
  const clipped = data.filter((d) => d.clique > yMax).length;
  return (
    <Card title="Clique count over stages"
          action={clipped > 0 ? <span className="chart-note">{clipped} kick spike{clipped > 1 ? 's' : ''} clipped</span> : undefined}>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 14, bottom: 0, left: 4 }}>
          <CartesianGrid stroke="var(--border-soft)" vertical={false} />
          <XAxis dataKey="stage" stroke="var(--faint)" tickLine={false} minTickGap={40} fontSize={11} />
          <YAxis tickFormatter={fmtNum} stroke="var(--faint)" tickLine={false} axisLine={false}
                 width={64} fontSize={11} domain={['auto', yMax]} allowDataOverflow />
          <Tooltip
            contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--border)',
              borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            labelStyle={{ color: 'var(--muted)' }}
            formatter={(v: number) => [fmtNum(v), 'cliques']} labelFormatter={(s) => `stage ${s}`} />
          <Line type="monotone" dataKey="clique" stroke="var(--green)" strokeWidth={2}
                dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
