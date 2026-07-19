import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import type { ProgressionPointDto } from '../types';
import { analyzeIls } from '../ils';
import { Card } from './Card';

const fmtNum = (n: number) => n.toLocaleString('en-US');

/**
 * Raw per-stage clique count on a LOG y-axis — the perturbation (ILS) cycle made
 * visible. A kick scrambles the incumbent up to ~3× the floor; the graph then
 * free-falls back over the next stages. Log scale keeps both the ~72k spike and
 * the ~26k floor legible in one view (linear would bury the floor detail), a
 * dashed reference line marks the incumbent (all-time best), and each kick is
 * marked where it fired. For a plain descending campaign it's just the descent.
 */
export function CliqueProgressionChart({ progression }: { progression: ProgressionPointDto[] }) {
  const sorted = [...progression]
    .filter((p) => p.cliqueCount != null)
    .sort((a, b) => a.stageId - b.stageId);
  const data = sorted.map((p) => ({ stage: p.stageId, clique: p.cliqueCount }));
  const ils = analyzeIls(progression);

  const counts = data.map((d) => d.clique);
  const lo = counts.length ? Math.min(...counts) : 1;
  const hi = counts.length ? Math.max(...counts) : 10;
  // Log domain padded a hair each side; must stay > 0.
  const domain: [number, number] = [Math.max(1, Math.floor(lo * 0.97)), Math.ceil(hi * 1.06)];

  const title = ils
    ? <>Clique count per stage <span className="dim">· log · {ils.kickCount} kick{ils.kickCount > 1 ? 's' : ''}</span></>
    : <>Clique count per stage <span className="dim">· log</span></>;

  return (
    <Card title={title}>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 14, bottom: 0, left: 4 }}>
          <CartesianGrid stroke="var(--border-soft)" vertical={false} />
          <XAxis dataKey="stage" type="number" domain={['dataMin', 'dataMax']}
                 stroke="var(--faint)" tickLine={false} minTickGap={40} fontSize={11}
                 tickFormatter={fmtNum} allowDataOverflow />
          <YAxis scale="log" domain={domain} allowDataOverflow tickFormatter={fmtNum}
                 stroke="var(--faint)" tickLine={false} axisLine={false} width={64} fontSize={11} />
          <Tooltip
            contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--border)',
              borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            labelStyle={{ color: 'var(--muted)' }}
            formatter={(v: number) => [fmtNum(v), 'cliques']} labelFormatter={(s) => `stage ${fmtNum(Number(s))}`} />
          {ils && (
            <ReferenceLine y={ils.incumbent} stroke="var(--accent)" strokeDasharray="4 4" strokeOpacity={0.8}
              label={{ value: `best ${fmtNum(ils.incumbent)}`, position: 'insideBottomLeft',
                fill: 'var(--accent)', fontSize: 10, fontFamily: 'var(--font-mono)' }} />
          )}
          {ils?.kickStageIds.map((sid) => (
            <ReferenceLine key={sid} x={sid} stroke="var(--red)" strokeDasharray="2 3" strokeOpacity={0.7}
              label={{ value: 'kick', position: 'top', fill: 'var(--red)', fontSize: 10, fontFamily: 'var(--font-mono)' }} />
          ))}
          <Line type="monotone" dataKey="clique" stroke="var(--green)" strokeWidth={1.5}
                dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
