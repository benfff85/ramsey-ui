import type { CampaignDto, ProgressionPointDto, LiveStageDto, ThroughputSample, FleetDto } from './types';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  getCampaigns: () => getJson<CampaignDto[]>('/api/dashboard/campaigns'),
  getFleets: () => getJson<FleetDto[]>('/api/dashboard/fleets'),
  // `sinceStageId` returns only the points after that stage. The full series is tens of
  // thousands of points and several megabytes, so callers holding the history poll for the tail.
  getProgression: (id: number, sinceStageId?: number) =>
    getJson<ProgressionPointDto[]>(`/api/dashboard/campaigns/${id}/progression`
      + (sinceStageId != null ? `?sinceStageId=${sinceStageId}` : '')),
  getLiveStage: (id: number) => getJson<LiveStageDto>(`/api/dashboard/stages/${id}/live`),
  getThroughputHistory: (windowSeconds: number) =>
    getJson<ThroughputSample[]>(`/api/dashboard/throughput/history?window=${windowSeconds}`),
};
