import type { BestResultDto } from './types';

export function formatEdges(r: BestResultDto): string {
  if (r.edges.length > 0) {
    return `[${r.edges.map(([u, v]) => `[${u}, ${v}]`).join(', ')}]`;
  }
  if (r.fullGraph) return '(full-graph result)';
  return '—';
}
