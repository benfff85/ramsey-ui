export interface ThroughputSample { ts: number; stageId: number | null; unitsPerSec: number; }

// Per-second socket payload: throughput + live stage stats, so the UI can drive the
// stat cards straight off the socket and follow stage transitions.
export interface LiveTick {
  ts: number; stageId: number | null; unitsPerSec: number;
  processedCount: number; workIndex: number; totalPairs: number;
  progressPct: number; cliqueCount: number | null;
}
export interface BestResultDto { cliqueCount: number; edges: number[][]; fullGraph: boolean; }
export interface LiveStageDto {
  stageId: number; processedCount: number; workIndex: number;
  totalPairs: number; progressPct: number; bestResults: BestResultDto[];
}
export interface CampaignDto {
  campaignId: number; subgraphSize: number; vertexCount: number; totalPairs: number | null;
  strategy: string; status: string; createdDate: string | null; updatedDate: string | null;
}
export interface ProgressionPointDto {
  stageId: number; graphId: number | null; cliqueCount: number;
  status: string; createdDate: string | null;
}
