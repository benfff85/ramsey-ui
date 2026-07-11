import { describe, expect, it } from 'vitest';
import { clipLimit, downsample, eligibleCampaigns, runningMin, seriesSlots } from './overlay';
import type { CampaignDto, ProgressionPointDto } from './types';

const campaign = (campaignId: number, vertexCount = 282, status = 'INACTIVE'): CampaignDto => ({
  campaignId, subgraphSize: 8, vertexCount, totalPairs: null,
  strategy: 'COMPREHENSIVE_EDGE_PAIR_MUTATION', status, createdDate: null, updatedDate: null,
});

const point = (stageId: number, cliqueCount: number): ProgressionPointDto => ({
  stageId, graphId: stageId, cliqueCount, status: 'INACTIVE', createdDate: null,
});

describe('eligibleCampaigns', () => {
  it('keeps only vertexCount 282 with campaignId >= 10, sorted ascending', () => {
    const cs = [campaign(13), campaign(3), campaign(10), campaign(12, 281), campaign(11)];
    expect(eligibleCampaigns(cs).map((c) => c.campaignId)).toEqual([10, 11, 13]);
  });

  it('caps at the 8 highest ids when more than 8 qualify', () => {
    const cs = Array.from({ length: 10 }, (_, i) => campaign(10 + i));
    expect(eligibleCampaigns(cs).map((c) => c.campaignId)).toEqual([12, 13, 14, 15, 16, 17, 18, 19]);
  });
});

describe('seriesSlots', () => {
  it('assigns slots by campaignId rank and stays stable when a campaign is added', () => {
    const before = seriesSlots([10, 11, 13]);
    const after = seriesSlots([10, 11, 12, 13]);
    expect(before.get(10)).toBe(1);
    expect(after.get(10)).toBe(1);
    expect(before.get(11)).toBe(2);
    expect(after.get(11)).toBe(2);
    // 13 shifts when 12 arrives — rank-based, documented behavior
    expect(before.get(13)).toBe(3);
    expect(after.get(13)).toBe(4);
  });
});

describe('runningMin', () => {
  it('emits change points only, plus the final point', () => {
    const pts = [point(5, 100), point(6, 90), point(7, 95), point(8, 95), point(9, 80), point(10, 85)];
    expect(runningMin(pts)).toEqual([
      { seq: 1, clique: 100 },
      { seq: 2, clique: 90 },
      { seq: 5, clique: 80 },
      { seq: 6, clique: 80 },
    ]);
  });

  it('sorts by stageId before computing', () => {
    const pts = [point(9, 80), point(5, 100), point(6, 90)];
    expect(runningMin(pts)).toEqual([
      { seq: 1, clique: 100 },
      { seq: 2, clique: 90 },
      { seq: 3, clique: 80 },
    ]);
  });

  it('handles empty input', () => {
    expect(runningMin([])).toEqual([]);
  });
});

describe('downsample', () => {
  it('returns short series unchanged', () => {
    const pts = [point(1, 3), point(2, 2)];
    expect(downsample(pts, 600)).toHaveLength(2);
  });

  it('keeps first and last and respects the target size', () => {
    const pts = Array.from({ length: 2000 }, (_, i) => point(i + 1, 5000 - i));
    const out = downsample(pts, 600);
    expect(out.length).toBeLessThanOrEqual(601);
    expect(out[0].seq).toBe(1);
    expect(out[out.length - 1].seq).toBe(2000);
  });
});

describe('clipLimit', () => {
  it('returns null when the longest is within 2x of the runner-up', () => {
    expect(clipLimit([463, 392, 700])).toBeNull();
  });

  it('clips at ceil(runnerUp * 1.1) when the longest dominates', () => {
    expect(clipLimit([8114, 1209, 463, 392])).toBe(1330);
  });

  it('returns null for fewer than two campaigns', () => {
    expect(clipLimit([8114])).toBeNull();
    expect(clipLimit([])).toBeNull();
  });
});
