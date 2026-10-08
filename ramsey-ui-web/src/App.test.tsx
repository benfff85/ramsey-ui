import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import App from './App';
import type { LiveTick } from './types';

// Recharts' ResponsiveContainer needs ResizeObserver (absent in jsdom).
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      <div style={{ width: 600, height: 300 }}>{children}</div>,
  };
});

// The live socket is driven by the test: each re-render can carry a new tick.
const socket: { byCampaign: Record<number, { samples: never[]; latest: LiveTick | null }>; connected: boolean } =
  { byCampaign: {}, connected: true };
vi.mock('./useThroughputSocket', () => ({ useThroughputSocket: () => socket }));

const tick = (stageId: number): LiveTick =>
  ({ ts: Date.now(), campaignId: 10, stageId, unitsPerSec: 3e9, cliqueCount: 25760 });
const point = (stageId: number) =>
  ({ stageId, graphId: stageId, cliqueCount: 25760, status: 'INACTIVE', createdDate: null, details: null, idx: stageId });

let calls: string[];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  calls = [];
  socket.byCampaign = {};
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const body = url.includes('/progression') ? [point(100), point(101)]
      : url.endsWith('/api/dashboard/campaigns')
        ? [{ campaignId: 10, subgraphSize: 8, vertexCount: 282, totalPairs: 1, strategy: 'S', status: 'ACTIVE',
             createdDate: null, updatedDate: '2026-10-08T00:00:00' }]
        : url.includes('/api/dashboard/stages/')
          ? { stageId: 1, processedCount: 0, workIndex: 0, totalPairs: 0, progressPct: 0,
              bestResults: [{ cliqueCount: 25761, edges: [[1, 2]], fullGraph: false }] }
          : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
});

afterEach(() => { vi.useRealTimers(); });

/** Render the dashboard on campaign 10 and let the initial fetches land. */
async function renderLive() {
  const view = render(<App />);
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  return view;
}

/** Simulate the fleet advancing: several stages a second, each arriving as a socket tick. */
async function advanceStages(view: ReturnType<typeof render>, from: number, count: number) {
  for (let s = from; s < from + count; s++) {
    socket.byCampaign = { 10: { samples: [], latest: tick(s) } };
    view.rerender(<App />);
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  }
}

describe('App at production stage rates', () => {
  it('shows neither the best-novel results nor the raw data, and never polls a stage', async () => {
    const view = await renderLive();
    await advanceStages(view, 102, 10);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });

    expect(screen.queryByText(/Best novel results/)).toBeNull();
    expect(screen.queryByText(/Raw data/)).toBeNull();
    expect(calls.filter((u) => u.includes('/api/dashboard/stages/'))).toEqual([]);
  });

  it('refreshes the progression tail on a 30 s timer, not on every stage advance', async () => {
    const view = await renderLive();
    const tails = () => calls.filter((u) => u.includes('sinceStageId')).length;

    await advanceStages(view, 102, 20); // 20 stage advances in ~3 s
    expect(tails()).toBe(0);

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(tails()).toBe(1);
  });
});
