import { describe, it, expect } from 'vitest';
import { formatEdges } from './format';

describe('formatEdges', () => {
  it('formats edge pairs including vertex 0', () => {
    expect(formatEdges({ cliqueCount: 1, edges: [[0, 7], [3, 9]], fullGraph: false }))
      .toBe('[[0, 7], [3, 9]]');
  });
  it('labels full-graph results', () => {
    expect(formatEdges({ cliqueCount: 1, edges: [], fullGraph: true })).toBe('(full-graph result)');
  });
  it('falls back to dash', () => {
    expect(formatEdges({ cliqueCount: 1, edges: [], fullGraph: false })).toBe('—');
  });
});
