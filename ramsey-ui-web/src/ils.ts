import type { ProgressionPointDto } from './types';

// ILS / perturbation constants — mirror the queue-manager RamseyConfig.Perturbation
// (PERTURBATION_BASIN_STALE_STAGES / _EDGE_PAIRS / _ESCALATION_CAP). The whole ILS state is
// derived client-side from the progression series, so the dashboard needs no extra backend
// endpoint. If those env values change in the QM, update these to match.
//
// These HAD drifted: this file said 100 while the QM ran 500, so the "stages since kick"
// countdown was wrong by 5x and would hit zero long before a kick actually fired. The stale
// comment above even named PERTURBATION_WALL_STAGES, the env var that basin-staleness replaced.
// Mirroring by hand is the underlying problem — the QM does not expose these, so nothing detects
// the drift. Worth serving them from the API if they change again.
export const BASIN_STALE_STAGES = 1000;
export const BASE_EDGE_PAIRS = 60;
export const ESCALATION_CAP = 64; // geometric: multipliers 1,2,4,8,16,32,64

export interface IlsState {
  incumbent: number;         // global campaign min — the graph the kicks are trying to beat
  kickStageIds: number[];    // stageId of each perturbation kick (from the PERTURBATION details marker)
  kickCount: number;
  lastKickStageId: number;
  stagesSinceKick: number;   // stages advanced since the last kick
  nextKickIn: number;        // stages until the next kick can fire (0 = due now)
  basinFloor: number | null; // best (min) count reached in the current post-kick basin
  stagesSinceBasinMin: number; // stages since that floor was last beaten — the QM's kick clock
  nextMultiplier: number;    // escalation strength the NEXT kick will use (x1..cap)
  etaHours: number | null;   // rough ETA to next kick from the recent near-floor stage rate
}

/**
 * Reconstruct the perturbation (ILS) state from a campaign's progression series.
 * Kicks are identified authoritatively by the "PERTURBATION" details marker on the stage
 * that a kick created (a clique-count spike heuristic is unreliable — big kicks' descents
 * drift and cross any threshold many times, badly over-counting). Returns null when no
 * kick is present (i.e. the campaign isn't running perturbation), so the caller hides ILS UI.
 */
export function analyzeIls(progression: ProgressionPointDto[]): IlsState | null {
  const sorted = [...progression]
    .filter((p) => p.cliqueCount != null)
    .sort((a, b) => a.stageId - b.stageId);
  if (!sorted.length) return null;

  const incumbent = Math.min(...sorted.map((p) => p.cliqueCount));

  const kickStageIds = sorted
    .filter((p) => p.details != null && p.details.startsWith('PERTURBATION'))
    .map((p) => p.stageId);
  const kickCount = kickStageIds.length;
  if (kickCount === 0) return null;

  const lastKickStageId = kickStageIds[kickCount - 1];
  // Stage counts come from the points' position in the FULL series, not from how many points we
  // were sent — the payload may be a sample, and counting rows would badly under-report. Falls
  // back to counting when idx is absent.
  const lastIdx = sorted[sorted.length - 1].idx;
  const stagesFrom = (stageId: number) => {
    const at = sorted.find((p) => p.stageId === stageId);
    return at?.idx != null && lastIdx != null
      ? lastIdx - at.idx
      : sorted.filter((p) => p.stageId > stageId).length;
  };
  const stagesSinceKick = stagesFrom(lastKickStageId);

  // Current basin floor: best (min) count reached since the last kick. The kick spike is the
  // MAX of this window, so it never affects the min — no need to filter it out.
  const postKick = sorted.filter((p) => p.stageId >= lastKickStageId);
  const basinFloor = postKick.length ? Math.min(...postKick.map((p) => p.cliqueCount)) : null;

  // The QM's kick clock runs from the stage that set the basin FLOOR, not from the kick, so a
  // descent that is still finding new minima is never interrupted however long it takes. `sorted`
  // is ascending by stageId, so find() picks the earliest tie — matching the QM's tie-break.
  const basinMinStageId = basinFloor == null
    ? null
    : postKick.find((p) => p.cliqueCount === basinFloor)!.stageId;
  const stagesSinceBasinMin = basinMinStageId == null ? 0 : stagesFrom(basinMinStageId);
  const nextKickIn = Math.max(0, BASIN_STALE_STAGES - stagesSinceBasinMin);

  // Escalation mirrors the QM: a kick that fails to set a NEW global min escalates strength.
  // The incumbent IS the global min; kicks that happened after it was already set never beat
  // it, so they count as the fruitless streak. Next kick strength = min(streak + 1, cap).
  const minStageId = sorted.find((p) => p.cliqueCount === incumbent)!.stageId;
  const fruitlessStreak = kickStageIds.filter((id) => id > minStageId).length;
  const nextMultiplier = Math.min(1 << Math.min(fruitlessStreak, 30), ESCALATION_CAP);

  // Rough ETA: seconds/stage over the most recent near-floor stages (excludes the fast
  // re-descent, which resolves ~1 stage/sec and would wildly under-estimate the wall rate).
  let etaHours: number | null = null;
  const floorRef = (basinFloor ?? incumbent) * 1.5; // walling stages hover near the floor; descent is 10x+
  const recent = sorted
    .filter((p) => p.stageId > lastKickStageId && p.cliqueCount <= floorRef && p.createdDate)
    .slice(-40);
  if (recent.length >= 2) {
    const spanSec = (new Date(recent[recent.length - 1].createdDate!).getTime()
      - new Date(recent[0].createdDate!).getTime()) / 1000;
    const perStage = spanSec / (recent.length - 1);
    if (perStage > 0) etaHours = (nextKickIn * perStage) / 3600;
  }

  return { incumbent, kickStageIds, kickCount, lastKickStageId, stagesSinceKick,
    nextKickIn, basinFloor, stagesSinceBasinMin, nextMultiplier, etaHours };
}

// Categorical colors for the per-kick series (mirror theme.css --series-*), cycled.
export const SERIES_COLORS = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)',
];

export interface EpochMeta { key: string; label: string; floor: number; color: string }
export interface EpochSeries {
  epochs: EpochMeta[];
  // One row per x = "stages since the epoch started" (all epochs re-based to 0), so the
  // series OVERLAY on a common left edge. Each row sets a key only for epochs that have a
  // point at that offset (others undefined → gap-broken lines).
  data: Array<Record<string, number>>;
  xMax: number; // x-domain cap: focuses the view on the kick-descent timescale
}

/**
 * Split a campaign's progression into kick-epochs — the "initial" descent, then one per
 * kick ("kick 1", "kick 2", …) — and re-base each to x=0 (stages since that epoch began)
 * so they overlay on a shared origin. This makes the descents directly comparable: every
 * kick free-falls from ~3× the floor, and you can see whether successive kicks bottom out
 * closer to the incumbent. Always returns at least one epoch (no kicks → single "initial").
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

  // Bucket points per epoch. x is "stages since this epoch began", taken from the point's
  // position in the FULL series (`idx`) rather than its position in the array we received —
  // the server may have sent a sample, and array position would compress the axis. Falls back to
  // array position when idx is absent (full, unsampled payload).
  const buckets: Array<Array<{ x: number; v: number }>> = Array.from({ length: nEpochs }, () => []);
  const epochStart: number[] = Array.from({ length: nEpochs }, () => -1);
  sorted.forEach((p, i) => {
    const e = epochOf(p.stageId);
    const pos = p.idx ?? i;
    if (epochStart[e] < 0) epochStart[e] = pos;
    buckets[e].push({ x: pos - epochStart[e], v: p.cliqueCount });
  });

  // One row per distinct x across all epochs; series with no point at an x simply omit the key.
  const xs = [...new Set(buckets.flatMap((b) => b.map((d) => d.x)))].sort((a, b) => a - b);
  const byEpoch = buckets.map((b) => new Map(b.map((d) => [d.x, d.v])));
  const data: Array<Record<string, number>> = xs.map((x) => {
    const row: Record<string, number> = { x };
    byEpoch.forEach((m, e) => { const v = m.get(x); if (v != null) row[`e${e}`] = v; });
    return row;
  });

  const epochs: EpochMeta[] = buckets.map((b, e) => ({
    key: `e${e}`,
    label: e === 0 ? 'initial' : `kick ${e}`,
    floor: Math.min(...b.map((d) => d.v)),
    color: SERIES_COLORS[e % SERIES_COLORS.length],
  }));

  // Cap x to the kick-descent timescale so young kicks aren't squished by the long
  // initial epoch (min 300 keeps the initial descent to the floor visible).
  const span = (b: Array<{ x: number }>) => (b.length ? b[b.length - 1].x + 1 : 0);
  const kickSpans = buckets.slice(1).map(span);
  const xMax = kickSpans.length ? Math.max(300, ...kickSpans) : Math.max(1, ...buckets.map(span));

  return { epochs, data, xMax };
}
