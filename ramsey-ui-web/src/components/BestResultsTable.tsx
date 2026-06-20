import type { LiveStageDto } from '../types';
import { formatEdges } from '../format';
import { Card } from './Card';

const fmt = (n: number) => n.toLocaleString('en-US');

export function BestResultsTable({ liveStage, currentClique }: {
  liveStage: LiveStageDto | null; currentClique: number;
}) {
  const rows = liveStage?.bestResults ?? [];
  return (
    <Card title={`Best novel results · ${rows.length} retained`}>
      {rows.length === 0 ? (
        <p className="muted">No results submitted yet for this stage.</p>
      ) : (
        <table>
          <thead>
            <tr><th>#</th><th className="num">Clique count</th><th className="num">Δ vs current</th><th>Edges to flip</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="num">{i + 1}</td>
                <td className="num">{fmt(r.cliqueCount)}</td>
                <td className="num">{fmt(r.cliqueCount - currentClique)}</td>
                <td className="num">{formatEdges(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
