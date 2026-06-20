import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import type { ProgressionPointDto } from '../types';
import { Card } from './Card';

const fmtNum = (n: number) => n.toLocaleString('en-US');

export function CliqueProgressionChart({ progression }: { progression: ProgressionPointDto[] }) {
  const data = [...progression].sort((a, b) => a.stageId - b.stageId)
    .map((p) => ({ stage: p.stageId, clique: p.cliqueCount }));
  return (
    <Card title="Clique count over stages">
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
            formatter={(v: number) => [fmtNum(v), 'cliques']} labelFormatter={(s) => `stage ${s}`} />
          <Line type="monotone" dataKey="clique" stroke="var(--green)" strokeWidth={2}
                dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
