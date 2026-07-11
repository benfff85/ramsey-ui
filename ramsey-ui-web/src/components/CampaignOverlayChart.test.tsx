import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { CampaignOverlayChart } from './CampaignOverlayChart';
import { api } from '../api';
import type { CampaignDto, ProgressionPointDto } from '../types';

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      <div style={{ width: 600, height: 300 }}>{children}</div>,
  };
});

vi.mock('../api', () => ({ api: { getProgression: vi.fn() } }));

const campaign = (campaignId: number, status = 'INACTIVE', vertexCount = 282): CampaignDto => ({
  campaignId, subgraphSize: 8, vertexCount, totalPairs: null,
  strategy: 'COMPREHENSIVE_EDGE_PAIR_MUTATION', status, createdDate: null, updatedDate: null,
});

const prog = (...cliques: number[]): ProgressionPointDto[] =>
  cliques.map((c, i) => ({ stageId: i + 1, graphId: i + 1, cliqueCount: c, status: 'INACTIVE', createdDate: null }));

describe('CampaignOverlayChart', () => {
  beforeEach(() => vi.mocked(api.getProgression).mockReset());

  it('renders a legend entry with the floor per eligible campaign, live-badged when ACTIVE', async () => {
    vi.mocked(api.getProgression).mockImplementation(async (id) =>
      id === 10 ? prog(27401, 26000, 25840, 26100) : prog(27798, 26464));
    render(<CampaignOverlayChart campaigns={[campaign(10), campaign(15, 'ACTIVE'), campaign(3)]} />);
    const legend = await screen.findByTestId('overlay-legend');
    expect(legend).toHaveTextContent('c10 · 25,840');
    expect(legend).toHaveTextContent('c15 · 26,464');
    expect(legend).toHaveTextContent('live');
    expect(api.getProgression).not.toHaveBeenCalledWith(3);
  });

  it('renders nothing when no campaign qualifies', async () => {
    const { container } = render(<CampaignOverlayChart campaigns={[campaign(3)]} />);
    await waitFor(() => expect(container.querySelector('.card')).toBeNull());
    expect(api.getProgression).not.toHaveBeenCalled();
  });
});
