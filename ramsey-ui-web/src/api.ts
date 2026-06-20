import type { CampaignDto, ProgressionPointDto, LiveStageDto, ThroughputSample } from './types';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  getCampaigns: () => getJson<CampaignDto[]>('/api/dashboard/campaigns'),
  getProgression: (id: number) => getJson<ProgressionPointDto[]>(`/api/dashboard/campaigns/${id}/progression`),
  getLiveStage: (id: number) => getJson<LiveStageDto>(`/api/dashboard/stages/${id}/live`),
  getThroughputHistory: (windowSeconds: number) =>
    getJson<ThroughputSample[]>(`/api/dashboard/throughput/history?window=${windowSeconds}`),
};
