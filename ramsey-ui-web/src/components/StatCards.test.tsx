import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCards, sortCampaigns } from './StatCards';
import type { CampaignDto, ProgressionPointDto, LiveStageDto } from '../types';

const camp = (id: number, status: string, updated: string): CampaignDto => ({
  campaignId: id, subgraphSize: 8, vertexCount: 281, totalPairs: 600,
  strategy: 'S', status, createdDate: updated, updatedDate: updated,
});

describe('sortCampaigns', () => {
  it('puts ACTIVE first, then newest updatedDate', () => {
    const out = sortCampaigns([
      camp(1, 'INACTIVE', '2026-06-10T00:00:00'),
      camp(2, 'INACTIVE', '2026-06-18T00:00:00'),
      camp(3, 'ACTIVE', '2026-06-01T00:00:00'),
    ]);
    expect(out.map((c) => c.campaignId)).toEqual([3, 2, 1]);
  });
});

describe('StatCards', () => {
  it('renders clique count and progress', () => {
    const first: ProgressionPointDto = { stageId: 1, graphId: 1, cliqueCount: 800000, status: 'COMPLETE', createdDate: null };
    const current: ProgressionPointDto = { stageId: 42, graphId: 2, cliqueCount: 775623, status: 'ACTIVE', createdDate: null };
    const live: LiveStageDto = { stageId: 42, processedCount: 1500, workIndex: 300, totalPairs: 600, progressPct: 50, bestResults: [] };
    render(<StatCards current={current} first={first} liveStage={live} />);
    expect(screen.getByText('775,623')).toBeInTheDocument();
    expect(screen.getByText('50.0%')).toBeInTheDocument();
  });
});
