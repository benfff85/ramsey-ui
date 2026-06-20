import { useState } from 'react';
import type { ProgressionPointDto } from '../types';
import { Card } from './Card';

const fmt = (n: number) => n.toLocaleString('en-US');

export function RawDataTable({ progression }: { progression: ProgressionPointDto[] }) {
  const [open, setOpen] = useState(false);
  const rows = [...progression].sort((a, b) => a.stageId - b.stageId);
  return (
    <Card>
      <button className="disclosure" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? '▾' : '▸'} Raw data · {rows.length} stages
      </button>
      {open && (
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr><th className="num">Stage</th><th className="num">Graph</th><th className="num">Clique count</th><th>Status</th><th>Created</th></tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.stageId}>
                <td className="num">{p.stageId}</td>
                <td className="num">{p.graphId ?? '—'}</td>
                <td className="num">{fmt(p.cliqueCount)}</td>
                <td>{p.status}</td>
                <td>{p.createdDate ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
