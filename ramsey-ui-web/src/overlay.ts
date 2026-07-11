import type { CampaignDto, ProgressionPointDto } from './types';

// The theme defines 8 fixed series slots (--series-1..8); hues are never cycled,
// so past 8 eligible campaigns we show the 8 most recent.
export const SERIES_SLOT_COUNT = 8;

export interface SeqPoint { seq: number; clique: number; }

/** Campaigns the overlay compares: the 282-vertex line, campaign 10 onward. */
export function eligibleCampaigns(campaigns: CampaignDto[]): CampaignDto[] {
  const eligible = campaigns
    .filter((c) => c.vertexCount === 282 && c.campaignId >= 10)
    .sort((a, b) => a.campaignId - b.campaignId);
  return eligible.slice(-SERIES_SLOT_COUNT);
}

/** Slot (1-based) per campaignId, by ascending id rank among those shown. */
export function seriesSlots(campaignIds: number[]): Map<number, number> {
  const sorted = [...campaignIds].sort((a, b) => a - b);
  return new Map(sorted.map((id, i) => [id, i + 1]));
}

/**
 * Running minimum as change points (plus the final point so the flat tail is
 * drawn); rendered with type="stepAfter" + connectNulls.
 */
export function runningMin(points: ProgressionPointDto[]): SeqPoint[] {
  const sorted = [...points].sort((a, b) => a.stageId - b.stageId);
  const out: SeqPoint[] = [];
  let min = Infinity;
  sorted.forEach((p, i) => {
    if (p.cliqueCount < min) {
      min = p.cliqueCount;
      out.push({ seq: i + 1, clique: min });
    }
  });
  const last = out[out.length - 1];
  if (last && last.seq !== sorted.length) {
    out.push({ seq: sorted.length, clique: min });
  }
  return out;
}

/** Stride-downsampled raw series (first and last always kept). */
export function downsample(points: ProgressionPointDto[], target: number): SeqPoint[] {
  const sorted = [...points].sort((a, b) => a.stageId - b.stageId);
  const stride = Math.max(1, Math.ceil(sorted.length / target));
  const out: SeqPoint[] = [];
  for (let i = 0; i < sorted.length; i += stride) {
    out.push({ seq: i + 1, clique: sorted[i].cliqueCount });
  }
  const lastIdx = sorted.length - 1;
  if (lastIdx >= 0 && out[out.length - 1].seq !== sorted.length) {
    out.push({ seq: sorted.length, clique: sorted[lastIdx].cliqueCount });
  }
  return out;
}

/**
 * X-axis cap: when one campaign is more than twice as long as the runner-up
 * (a long-running campaign cycling on its floor would squash everyone else),
 * clip at ceil(runnerUp * 1.1). Null = no clipping.
 */
export function clipLimit(lengths: number[]): number | null {
  if (lengths.length < 2) return null;
  const sorted = [...lengths].sort((a, b) => b - a);
  const [longest, runnerUp] = sorted;
  if (longest <= 2 * runnerUp) return null;
  return Math.ceil(runnerUp * 1.1);
}
