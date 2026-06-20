import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts';
import type { ProgressionPointDto } from '../types';
import { Card } from './Card';

const fmtNum = (n: number) => n.toLocaleString('en-US');

export function ImprovementChart({ progression }: { progression: ProgressionPointDto[] }) {
  const sorted = [...progression].sort((a, b) => a.stageId - b.stageId);
  const data = sorted.slice(1).map((p, i) => ({
    stage: String(p.stageId),
    improvement: sorted[i].cliqueCount - p.cliqueCount, // positive = improvement
  }));
  return (
    <Card title="Improvement per stage">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 14, bottom: 0, left: 4 }}>
          <CartesianGrid stroke="var(--border-soft)" vertical={false} />
          <XAxis dataKey="stage" stroke="var(--faint)" tickLine={false} minTickGap={24} fontSize={11} />
          <YAxis tickFormatter={fmtNum} stroke="var(--faint)" tickLine={false} axisLine={false}
                 width={56} fontSize={11} />
          <Tooltip
            contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--border)',
              borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            labelStyle={{ color: 'var(--muted)' }}
            cursor={{ fill: 'rgba(255,255,255,0.03)' }}
            formatter={(v: number) => [fmtNum(v), 'Δ cliques']} labelFormatter={(s) => `stage ${s}`} />
          <Bar dataKey="improvement" isAnimationActive={false} radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.improvement >= 0 ? 'var(--green)' : 'var(--red)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}
