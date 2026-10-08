import type { CampaignDto, ProgressionPointDto, ThroughputSample, FleetDto } from './types';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  getCampaigns: () => getJson<CampaignDto[]>('/api/dashboard/campaigns'),
  getFleets: () => getJson<FleetDto[]>('/api/dashboard/fleets'),
  // Always bounded: a structural sample of at most `maxPoints` (server default 3,000), or with
  // `sinceStageId` only the points after that stage, for callers holding a sample.
  getProgression: (id: number, sinceStageId?: number, maxPoints?: number) =>
    getJson<ProgressionPointDto[]>(`/api/dashboard/campaigns/${id}/progression`
      + (sinceStageId != null ? `?sinceStageId=${sinceStageId}`
         : maxPoints != null ? `?maxPoints=${maxPoints}` : '')),
  getThroughputHistory: (windowSeconds: number) =>
    getJson<ThroughputSample[]>(`/api/dashboard/throughput/history?window=${windowSeconds}`),
};
