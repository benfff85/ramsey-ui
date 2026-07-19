import type { ProgressionPointDto } from './types';

// ILS / perturbation constants — mirror the queue-manager RamseyConfig.Perturbation
// (PERTURBATION_WALL_STAGES / _EDGE_PAIRS / _ESCALATION_CAP). The whole ILS state is
// derived client-side from the progression series, so the dashboard needs no extra
// backend endpoint. If those env values change in the QM, update these to match.
export const KICK_FACTOR = 1.5;
export const WALL_STAGES = 500;
export const BASE_EDGE_PAIRS = 30;
export const ESCALATION_CAP = 4;

export interface IlsState {
  incumbent: number;         // global campaign min — the graph the kicks are trying to beat
  kickStageIds: number[];    // stageId at each kick's spike (rising edge above threshold)
  kickCount: number;
  lastKickStageId: number;
  stagesSinceKick: number;   // stages advanced since the last kick
  nextKickIn: number;        // stages until the next kick can fire (0 = due now)
  basinFloor: number | null; // best (min) count reached in the current post-kick basin
  nextMultiplier: number;    // escalation strength the NEXT kick will use (x1..cap)
  etaHours: number | null;   // rough ETA to next kick from the recent near-floor stage rate
}

/**
 * Reconstruct the perturbation (ILS) state from a campaign's progression series.
 * A "kick" is the rising edge where the raw per-stage count jumps above
 * KICK_FACTOR × incumbent (a scrambled graph sits ~3× the floor); its descent then
 * falls back below the threshold. Returns null when no kick is present (i.e. the
 * campaign isn't running perturbation), so the caller can hide ILS UI.
 */
export function analyzeIls(progression: ProgressionPointDto[]): IlsState | null {
  const sorted = [...progression]
    .filter((p) => p.cliqueCount != null)
    .sort((a, b) => a.stageId - b.stageId);
  if (!sorted.length) return null;

  const incumbent = Math.min(...sorted.map((p) => p.cliqueCount));
  const threshold = incumbent * KICK_FACTOR;

  const kickStageIds: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i].cliqueCount;
    const prev = i > 0 ? sorted[i - 1].cliqueCount : 0;
    if (cur > threshold && prev <= threshold) kickStageIds.push(sorted[i].stageId);
  }
  const kickCount = kickStageIds.length;
  if (kickCount === 0) return null;

  const lastKickStageId = kickStageIds[kickCount - 1];
  const stagesSinceKick = sorted.filter((p) => p.stageId > lastKickStageId).length;
  const nextKickIn = Math.max(0, WALL_STAGES - stagesSinceKick);

  // Current basin floor: best count reached since the last kick, once re-descended below threshold.
  const postKick = sorted.filter((p) => p.stageId >= lastKickStageId && p.cliqueCount <= threshold);
  const basinFloor = postKick.length ? Math.min(...postKick.map((p) => p.cliqueCount)) : null;

  // Escalation mirrors the QM: a kick that fails to set a NEW global min escalates strength.
  // The incumbent IS the global min; kicks that happened after it was already set never beat
  // it, so they count as the fruitless streak. Next kick strength = min(streak + 1, cap).
  const minStageId = sorted.find((p) => p.cliqueCount === incumbent)!.stageId;
  const fruitlessStreak = kickStageIds.filter((id) => id > minStageId).length;
  const nextMultiplier = Math.min(fruitlessStreak + 1, ESCALATION_CAP);

  // Rough ETA: seconds/stage over the most recent near-floor stages (excludes the fast
  // re-descent, which resolves ~1 stage/sec and would wildly under-estimate the wall rate).
  let etaHours: number | null = null;
  const recent = sorted
    .filter((p) => p.stageId > lastKickStageId && p.cliqueCount <= threshold && p.createdDate)
    .slice(-40);
  if (recent.length >= 2) {
    const spanSec = (new Date(recent[recent.length - 1].createdDate!).getTime()
      - new Date(recent[0].createdDate!).getTime()) / 1000;
    const perStage = spanSec / (recent.length - 1);
    if (perStage > 0) etaHours = (nextKickIn * perStage) / 3600;
  }

  return { incumbent, kickStageIds, kickCount, lastKickStageId, stagesSinceKick,
    nextKickIn, basinFloor, nextMultiplier, etaHours };
}

// Categorical colors for the per-kick series (mirror theme.css --series-*), cycled.
export const SERIES_COLORS = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)',
];

export interface EpochMeta { key: string; label: string; floor: number; color: string }
export interface EpochSeries {
  epochs: EpochMeta[];
  // One row per stage; each row sets only its own epoch's key (others undefined) so
  // recharts draws a separate, gap-broken line per epoch (the kick jump is a real gap).
  data: Array<Record<string, number>>;
}

/**
 * Split a campaign's progression into kick-epochs: everything before the first kick is
 * the "initial" descent, then each kick starts a new epoch ("kick 1", "kick 2", …).
 * Each epoch becomes its own colored series so the chart overlays them by stage. Always
 * returns at least one epoch (a campaign with no kicks is a single "initial" series).
 */
export function epochSeries(progression: ProgressionPointDto[]): EpochSeries | null {
  const sorted = [...progression]
    .filter((p) => p.cliqueCount != null)
    .sort((a, b) => a.stageId - b.stageId);
  if (!sorted.length) return null;

  const ils = analyzeIls(progression);
  const kicks = ils ? ils.kickStageIds : [];
  const epochOf = (stageId: number) => kicks.filter((k) => k <= stageId).length;
  const nEpochs = kicks.length + 1;

  const data = sorted.map((p) => ({ stage: p.stageId, [`e${epochOf(p.stageId)}`]: p.cliqueCount }));

  const epochs: EpochMeta[] = [];
  for (let e = 0; e < nEpochs; e++) {
    const pts = sorted.filter((p) => epochOf(p.stageId) === e);
    epochs.push({
      key: `e${e}`,
      label: e === 0 ? 'initial' : `kick ${e}`,
      floor: Math.min(...pts.map((p) => p.cliqueCount)),
      color: SERIES_COLORS[e % SERIES_COLORS.length],
    });
  }
  return { epochs, data };
}
