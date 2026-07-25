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

const s = (ts: number, ups: number): ThroughputSample => ({ ts, campaignId: 1, stageId: 1, unitsPerSec: ups });

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

  it('renders axis ticks compactly so wide values are not clipped', () => {
    // Throughput reached tens of millions after the kernel work; "46,153,846" overflows the
    // 56px axis gutter and loses its leading digit, so ticks must be compact.
    const now = Date.now();
    const samples = [
      { timestamp: now - 10_000, unitsPerSecond: 46_153_846, cliqueCount: 1, stageId: 1, campaignId: 10 },
      { timestamp: now, unitsPerSecond: 47_000_000, cliqueCount: 1, stageId: 1, campaignId: 10 },
    ] as unknown as Parameters<typeof ThroughputChart>[0]['samples'];
    const { container } = render(<ThroughputChart samples={samples} interval={5} />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/46,153,846/);
  });
});