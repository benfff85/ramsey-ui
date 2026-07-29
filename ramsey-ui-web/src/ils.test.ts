import { describe, it, expect } from 'vitest';
import { analyzeIls, epochSeries, BASIN_STALE_STAGES, ESCALATION_CAP } from './ils';
import type { ProgressionPointDto } from './types';

const pt = (stageId: number, cliqueCount: number, createdDate: string | null = null): ProgressionPointDto =>
  ({ stageId, cliqueCount, graphId: stageId, status: 'COMPLETE', createdDate, details: null });
// A perturbation kick stage — how kicks are identified (the PERTURBATION details marker).
const kick = (stageId: number, cliqueCount: number, createdDate: string | null = null): ProgressionPointDto =>
  ({ ...pt(stageId, cliqueCount, createdDate), details: 'PERTURBATION kick from graph 1 (25840), pairs=60' });

describe('analyzeIls', () => {
  it('returns null for a plain descending campaign (no kicks)', () => {
    const prog = [pt(1, 27000), pt(2, 26500), pt(3, 26000), pt(4, 25840)];
    expect(analyzeIls(prog)).toBeNull();
  });

  it('does NOT count clique spikes without the PERTURBATION marker as kicks', () => {
    // A big count with no details marker (e.g. drift during a descent) must not register.
    const prog = [pt(1, 25840), pt(2, 200000), pt(3, 26000), pt(4, 26010)];
    expect(analyzeIls(prog)).toBeNull();
  });

  it('detects a kick by its PERTURBATION details marker', () => {
    // floor 25840; kick to 72k at stage 10; re-descent back to ~26000
    const prog = [
      pt(1, 25840), pt(2, 25900), pt(3, 26000),
      kick(10, 72000), pt(11, 50000), pt(12, 30000), pt(13, 26050), pt(14, 26023),
    ];
    const ils = analyzeIls(prog)!;
    expect(ils.kickCount).toBe(1);
    expect(ils.kickStageIds).toEqual([10]);
    expect(ils.incumbent).toBe(25840);
    expect(ils.lastKickStageId).toBe(10);
    expect(ils.stagesSinceKick).toBe(4); // stages 11..14
    expect(ils.basinFloor).toBe(26023);  // best since the kick (spike is the max, ignored)
    // Still descending — the floor was set on the LAST stage, so the stale clock is at 0
    // and the full window remains. A descent in free fall is never kicked.
    expect(ils.stagesSinceBasinMin).toBe(0);
    expect(ils.nextKickIn).toBe(BASIN_STALE_STAGES);
  });

  it('counts staleness from the basin floor, not from the kick', () => {
    // Floor 26050 set at stage 11, then 30 flat stages: the clock reads 30, not the 31
    // stages elapsed since the kick. Mirrors the QM's basin-staleness gate.
    const prog = [pt(1, 25840), kick(10, 72000)];
    for (let s = 11; s <= 41; s++) prog.push(pt(s, s === 11 ? 26050 : 26060));
    const ils = analyzeIls(prog)!;
    expect(ils.basinFloor).toBe(26050);
    expect(ils.stagesSinceKick).toBe(31);
    expect(ils.stagesSinceBasinMin).toBe(30);
    expect(ils.nextKickIn).toBe(BASIN_STALE_STAGES - 30);
  });

  it('escalates the next-kick multiplier for a fruitless kick', () => {
    // incumbent set at stage 1 (before the kick) and never beaten -> next kick escalates to x2
    const prog = [pt(1, 25840), pt(2, 26000), kick(10, 72000), pt(11, 26050)];
    expect(analyzeIls(prog)!.nextMultiplier).toBe(2);
  });

  it('does not escalate when the incumbent was set after (by) the last kick', () => {
    // the kick's descent set a new global min -> streak resets, next kick x1
    const prog = [pt(1, 30000), pt(2, 27000), kick(10, 72000), pt(11, 25840)];
    const ils = analyzeIls(prog)!;
    expect(ils.incumbent).toBe(25840);
    expect(ils.nextMultiplier).toBe(1);
  });

  it('escalates geometrically and caps at ESCALATION_CAP', () => {
    // 2 fruitless kicks -> streak 2 -> 1<<2 = x4 next
    const two = [pt(1, 25840), kick(10, 72000), pt(11, 26000), kick(20, 72000), pt(21, 26000)];
    expect(analyzeIls(two)!.nextMultiplier).toBe(4);
    // Enough fruitless kicks that 1<<streak STRICTLY exceeds the cap, derived from the cap so
    // the clamp is still exercised when a tier is added. The old fixture hardcoded 6 kicks to
    // overshoot a cap of 32; raising the cap to 64 made 1<<6 land exactly ON it, so the test
    // passed while no longer testing clamping at all.
    const needed = Math.log2(ESCALATION_CAP) + 1;
    const prog = [pt(1, 25840)];
    for (let i = 1; i <= needed; i++) {
      prog.push(kick(i * 10, 72000), pt(i * 10 + 1, 26000));
    }
    const ils = analyzeIls(prog)!;
    expect(ils.kickCount).toBe(needed);
    expect(1 << needed).toBeGreaterThan(ESCALATION_CAP); // fixture really does overshoot
    expect(ils.nextMultiplier).toBe(ESCALATION_CAP);
  });

  it('estimates ETA from the recent near-floor stage rate', () => {
    // near-floor stages 60s apart -> 60s/stage; BASIN_STALE_STAGES left -> that many minutes
    const prog = [
      pt(1, 25840),
      kick(10, 72000, '2026-07-19T01:00:00Z'),
      pt(11, 26050, '2026-07-19T01:01:00Z'),
      pt(12, 26040, '2026-07-19T01:02:00Z'),
    ];
    const ils = analyzeIls(prog)!;
    expect(ils.nextKickIn).toBe(BASIN_STALE_STAGES);
    expect(ils.etaHours).toBeCloseTo(BASIN_STALE_STAGES * 60 / 3600, 1);
  });
});

describe('epochSeries', () => {
  it('is a single "initial" series when there are no kicks, re-based to x=0', () => {
    const s = epochSeries([pt(1, 27000), pt(2, 26000), pt(3, 25840)])!;
    expect(s.epochs.map((e) => e.label)).toEqual(['initial']);
    expect(s.epochs[0].floor).toBe(25840);
    expect(s.data).toEqual([{ x: 0, e0: 27000 }, { x: 1, e0: 26000 }, { x: 2, e0: 25840 }]);
    expect(s.xMax).toBe(3);
  });

  it('overlays each epoch on a common x=0 origin (stages since epoch start)', () => {
    const s = epochSeries([
      pt(1, 25840), pt(2, 26000), pt(3, 26100),
      kick(10, 72000), pt(11, 26050),
    ])!;
    expect(s.epochs.map((e) => e.label)).toEqual(['initial', 'kick 1']);
    // Both epochs start at x=0: initial's first point and the kick spike share the left edge.
    expect(s.data[0]).toEqual({ x: 0, e0: 25840, e1: 72000 });
    expect(s.data[1]).toEqual({ x: 1, e0: 26000, e1: 26050 });
    // initial runs longer; beyond the kick's length only e0 is present.
    expect(s.data[2]).toEqual({ x: 2, e0: 26100 });
    expect(s.epochs[0].floor).toBe(25840); // initial descent floor
    expect(s.epochs[1].floor).toBe(26050); // kick-1 basin floor
    expect(s.epochs[0].color).not.toEqual(s.epochs[1].color);
    expect(s.xMax).toBe(300); // min window keeps the initial descent visible
  });

  /**
   * The server may send a SAMPLE of the series rather than all of it. Stage counts must come from
   * each point's true position (idx), not from how many rows arrived — counting rows would make
   * "next kick in" read wildly early and misrepresent how long a basin has been stale.
   */
  it('reports true stage counts when the payload is a sample', () => {
    const idx = (p: ProgressionPointDto, i: number): ProgressionPointDto => ({ ...p, idx: i });
    // Sampled payload: idx carries the TRUE position, so counts must come from idx, not row
    // count. Sized off BASIN_STALE_STAGES so the "past the window" intent survives a config
    // change -- hardcoding it here is what let this file drift from the QM in the first place.
    const end = 2 * BASIN_STALE_STAGES;          // last true position
    const floorAt = BASIN_STALE_STAGES / 2;      // basin floor comfortably > one window back
    const prog = [
      idx(pt(1, 30000), 0),
      idx(kick(101, 900000), 100),
      idx(pt(floorAt + 1, 26000), floorAt),      // basin floor
      idx(pt(end + 1, 26500), end),              // latest
    ];
    const ils = analyzeIls(prog)!;
    expect(ils.stagesSinceKick).toBe(end - 100);            // from idx, not 2 rows
    expect(ils.basinFloor).toBe(26000);
    expect(ils.stagesSinceBasinMin).toBe(end - floorAt);    // from idx, not 1 row
    expect(ils.nextKickIn).toBe(0);                         // genuinely past the stale window
  });

  /** Without idx (full payload) the old row-counting behaviour still applies. */
  it('falls back to counting rows when idx is absent', () => {
    const prog = [pt(1, 30000), kick(10, 90000), pt(11, 26000), pt(12, 26100), pt(13, 26200)];
    const ils = analyzeIls(prog)!;
    expect(ils.stagesSinceKick).toBe(3);
    expect(ils.stagesSinceBasinMin).toBe(2);
  });
});