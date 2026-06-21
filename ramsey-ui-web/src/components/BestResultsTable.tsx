import type { BestResultDto } from '../types';
import { formatEdges } from '../format';
import { Card } from './Card';

const fmt = (n: number) => n.toLocaleString('en-US');

export function BestResultsTable({ bestResults, currentClique }: {
  bestResults: BestResultDto[]; currentClique: number;
}) {
  return (
    <Card title={`Best novel results · ${bestResults.length} retained`}>
      {bestResults.length === 0 ? (
        <p className="muted">No results submitted yet for this stage.</p>
      ) : (
        <table>
          <thead>
            <tr><th>#</th><th className="num">Clique count</th><th className="num">Δ vs current</th><th>Edges to flip</th></tr>
          </thead>
          <tbody>
            {bestResults.map((r, i) => (
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
