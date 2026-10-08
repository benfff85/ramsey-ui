export interface ThroughputSample { ts: number; campaignId: number | null; stageId: number | null; unitsPerSec: number; }

// Per-second socket payload: throughput plus the stat-card values (stage, clique count).
export interface LiveTick {
  ts: number; campaignId: number | null; stageId: number | null; unitsPerSec: number;
  cliqueCount: number | null;
}
export interface CampaignDto {
  campaignId: number; subgraphSize: number; vertexCount: number; totalPairs: number | null;
  strategy: string; status: string; createdDate: string | null; updatedDate: string | null;
}
export interface ProgressionPointDto {
  stageId: number; graphId: number | null; cliqueCount: number;
  status: string; createdDate: string | null;
  details: string | null; // "PERTURBATION kick from graph ..." on kick stages
  // Position in the campaign's FULL series, stamped server-side before any downsampling, so the
  // x-axis reads in real stages even when only a sample was sent.
  idx?: number | null;
}
export interface FleetDto {
  platform: string; campaignId: number | null; status: string;
  note: string | null; updatedDate: string | null;
}
