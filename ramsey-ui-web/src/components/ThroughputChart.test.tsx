import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ThroughputChart } from './ThroughputChart';
import type { ThroughputSample } from '../types';

// Recharts' ResponsiveContainer uses ResizeObserver (absent in jsdom); stub it so the
// component renders without measuring. We assert on the DOM headline, not chart layout.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      <div style={{ width: 600, height: 300 }}>{children}</div>,
  };
});

const s = (ts: number, ups: number): ThroughputSample => ({ ts, stageId: 1, unitsPerSec: ups });

describe('ThroughputChart', () => {
  it('shows the latest bucketed value as the headline', () => {
    render(<ThroughputChart samples={[s(1000, 100), s(2000, 140)]} interval={1} />);
    expect(screen.getByTestId('ups-headline')).toHaveTextContent('140u/s');
  });

  it('averages the headline over the selected bucket', () => {
    // one 5s bucket: mean of 10,20,30 = 20
    render(<ThroughputChart samples={[s(1000, 10), s(2000, 20), s(3000, 30)]} interval={5} />);
    expect(screen.getByTestId('ups-headline')).toHaveTextContent('20u/s');
  });

  it('does not throw when empty', () => {
    expect(() => render(<ThroughputChart samples={[]} interval={5} />)).not.toThrow();
  });
});
