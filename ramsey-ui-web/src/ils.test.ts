import { describe, it, expect } from 'vitest';
import { analyzeIls, epochSeries } from './ils';
import type { ProgressionPointDto } from './types';

const pt = (stageId: number, cliqueCount: number, createdDate: string | null = null): ProgressionPointDto =>
  ({ stageId, cliqueCount, graphId: stageId, status: 'COMPLETE', createdDate });

describe('analyzeIls', () => {
  it('returns null for a plain descending campaign (no kicks)', () => {
    const prog = [pt(1, 27000), pt(2, 26500), pt(3, 26000), pt(4, 25840)];
    expect(analyzeIls(prog)).toBeNull();
  });

  it('detects one kick as a rising edge above 1.5x the incumbent', () => {
    // floor 25840; kick to 72k at stage 10; re-descent back to ~26000
    const prog = [
      pt(1, 25840), pt(2, 25900), pt(3, 26000),
      pt(10, 72000), pt(11, 50000), pt(12, 30000), pt(13, 26050), pt(14, 26023),
    ];
    const ils = analyzeIls(prog)!;
    expect(ils.kickCount).toBe(1);
    expect(ils.kickStageIds).toEqual([10]);
    expect(ils.incumbent).toBe(25840);
    expect(ils.lastKickStageId).toBe(10);
    expect(ils.stagesSinceKick).toBe(4); // stages 11..14
    expect(ils.nextKickIn).toBe(496);    // 500 - 4
    expect(ils.basinFloor).toBe(26023);  // best post-kick below threshold
  });

  it('escalates the next-kick multiplier for a fruitless kick', () => {
    // incumbent set at stage 1 (before the kick) and never beaten -> next kick escalates to x2
    const prog = [pt(1, 25840), pt(2, 26000), pt(10, 72000), pt(11, 26050)];
    expect(analyzeIls(prog)!.nextMultiplier).toBe(2);
  });

  it('does not escalate when the incumbent was set after (by) the last kick', () => {
    // the kick's descent set a new global min -> streak resets, next kick x1
    const prog = [pt(1, 30000), pt(2, 27000), pt(10, 72000), pt(11, 25840)];
    const ils = analyzeIls(prog)!;
    expect(ils.incumbent).toBe(25840);
    expect(ils.nextMultiplier).toBe(1);
  });

  it('counts multiple kicks and caps escalation at 4', () => {
    const prog = [
      pt(1, 25840),
      pt(10, 72000), pt(11, 26000),
      pt(20, 72000), pt(21, 26000),
      pt(30, 72000), pt(31, 26000),
      pt(40, 72000), pt(41, 26000),
      pt(50, 72000), pt(51, 26000),
    ];
    const ils = analyzeIls(prog)!;
    expect(ils.kickCount).toBe(5);
    expect(ils.nextMultiplier).toBe(4); // min(5 + 1, cap 4)
  });

  it('estimates ETA from the recent near-floor stage rate', () => {
    // 3 near-floor stages 60s apart -> 60s/stage; 498 stages left -> 8.3h
    const prog = [
      pt(1, 25840),
      pt(10, 72000, '2026-07-19T01:00:00Z'),
      pt(11, 26050, '2026-07-19T01:01:00Z'),
      pt(12, 26040, '2026-07-19T01:02:00Z'),
    ];
    const ils = analyzeIls(prog)!;
    expect(ils.nextKickIn).toBe(498);
    expect(ils.etaHours).toBeCloseTo(498 * 60 / 3600, 1);
  });
});

describe('epochSeries', () => {
  it('is a single "initial" series when there are no kicks', () => {
    const s = epochSeries([pt(1, 27000), pt(2, 26000), pt(3, 25840)])!;
    expect(s.epochs.map((e) => e.label)).toEqual(['initial']);
    expect(s.epochs[0].floor).toBe(25840);
    expect(s.data).toEqual([{ stage: 1, e0: 27000 }, { stage: 2, e0: 26000 }, { stage: 3, e0: 25840 }]);
  });

  it('splits into initial + one series per kick, each row keyed to its own epoch', () => {
    const s = epochSeries([
      pt(1, 25840), pt(2, 26000),
      pt(10, 72000), pt(11, 26050),
    ])!;
    expect(s.epochs.map((e) => e.label)).toEqual(['initial', 'kick 1']);
    // pre-kick rows carry e0 only; kick rows carry e1 only (gap-broken lines)
    expect(s.data[0]).toEqual({ stage: 1, e0: 25840 });
    expect(s.data[2]).toEqual({ stage: 10, e1: 72000 });
    expect(s.epochs[0].floor).toBe(25840); // initial descent floor
    expect(s.epochs[1].floor).toBe(26050); // kick-1 basin floor
    expect(s.epochs[0].color).not.toEqual(s.epochs[1].color);
  });
});
