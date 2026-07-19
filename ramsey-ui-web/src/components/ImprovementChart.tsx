import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts';
import type { ProgressionPointDto } from '../types';
import { Card } from './Card';

const fmtNum = (n: number) => n.toLocaleString('en-US');

// A transition into or out of a perturbation kick stage (base graph ~3x the floor)
// produces a huge artificial delta (±tens of thousands) that would blow out the
// scale and hide the real per-stage improvements. Exclude those transitions.
const KICK_FACTOR = 1.5;

export function ImprovementChart({ progression }: { progression: ProgressionPointDto[] }) {
  const sorted = [...progression].sort((a, b) => a.stageId - b.stageId);
  const min = sorted.length ? Math.min(...sorted.map((p) => p.cliqueCount)) : 0;
  const threshold = min * KICK_FACTOR;
  const data = sorted.slice(1).map((p, i) => {
    const kickTransition = p.cliqueCount > threshold || sorted[i].cliqueCount > threshold;
    return {
      stage: String(p.stageId),
      improvement: kickTransition ? null : sorted[i].cliqueCount - p.cliqueCount, // positive = improvement
    };
  });
  const hidden = data.filter((d) => d.improvement === null).length;
  // A kick's re-descent has large real deltas (thousands) below the kick threshold
  // that would still dwarf the normal per-stage improvements (tens–hundreds). Clip
  // the y-axis to a robust symmetric bound (98th pct of |delta|) so the normal
  // distribution is visible; the few large re-descent bars clip at the edge.
  const mags = data.map((d) => d.improvement).filter((x): x is number => x !== null)
    .map(Math.abs).sort((a, b) => a - b);
  const bound = mags.length ? Math.max(50, mags[Math.floor(mags.length * 0.98)]) : 100;
  return (
    <Card title="Improvement per stage"
          action={hidden > 0
            ? <span className="chart-note">{hidden} kick transition{hidden > 1 ? 's' : ''} hidden</span>
            : undefined}>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 14, bottom: 0, left: 4 }}>
          <CartesianGrid stroke="var(--border-soft)" vertical={false} />
          <XAxis dataKey="stage" stroke="var(--faint)" tickLine={false} minTickGap={24} fontSize={11} />
          <YAxis tickFormatter={fmtNum} stroke="var(--faint)" tickLine={false} axisLine={false}
                 width={56} fontSize={11} domain={[-bound, bound]} allowDataOverflow />
          <Tooltip
            contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--border)',
              borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            labelStyle={{ color: 'var(--muted)' }}
            cursor={{ fill: 'rgba(255,255,255,0.03)' }}
            formatter={(v: number) => [fmtNum(v), 'Δ cliques']} labelFormatter={(s) => `stage ${s}`} />
          <Bar dataKey="improvement" isAnimationActive={false} radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={(d.improvement ?? 0) >= 0 ? 'var(--green)' : 'var(--red)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}
