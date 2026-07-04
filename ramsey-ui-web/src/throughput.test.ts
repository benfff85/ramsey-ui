import { describe, it, expect } from 'vitest';
import { bucketSamples, mergeHistory, mergeSample } from './throughput';
import type { ThroughputSample } from './types';

const s = (ts: number, ups: number): ThroughputSample => ({ ts, campaignId: 1, stageId: 1, unitsPerSec: ups });

describe('bucketSamples', () => {
  it('passes 1s through unchanged', () => {
    const out = bucketSamples([s(1000, 10), s(2000, 20)], 1);
    expect(out).toEqual([{ t: 1000, ups: 10 }, { t: 2000, ups: 20 }]);
  });

  it('averages within a 5s bucket', () => {
    // 1000..5999 -> one 5s bucket keyed at 0; mean of 10,20,30
    const out = bucketSamples([s(1000, 10), s(2000, 20), s(3000, 30)], 5);
    expect(out).toHaveLength(1);
    expect(out[0].ups).toBe(20);
  });
});

describe('mergeSample', () => {
  it('appends and caps to maxPoints', () => {
    let arr: ThroughputSample[] = [s(1000, 1), s(2000, 2)];
    arr = mergeSample(arr, s(3000, 3), 2);
    expect(arr.map((x) => x.ts)).toEqual([2000, 3000]);
  });
});

describe('mergeHistory', () => {
  const c = (ts: number, ups: number): ThroughputSample => ({ ts, campaignId: 12, stageId: 9, unitsPerSec: ups });

  it('sorts history under live ticks that arrived first', () => {
    // socket ticks (newer) landed before the REST history (older) resolved
    const live = [c(5000, 50), c(6000, 60)];
    const history = [c(1000, 10), c(2000, 20), c(3000, 30)];
    const out = mergeHistory(live, history, 100);
    expect(out.map((x) => x.ts)).toEqual([1000, 2000, 3000, 5000, 6000]);
  });

  it('dedupes samples with the same timestamp', () => {
    const out = mergeHistory([c(1000, 10)], [c(1000, 10), c(2000, 20)], 100);
    expect(out.map((x) => x.ts)).toEqual([1000, 2000]);
  });

  it('caps to the newest maxPoints', () => {
    const out = mergeHistory([c(4000, 4)], [c(1000, 1), c(2000, 2), c(3000, 3)], 2);
    expect(out.map((x) => x.ts)).toEqual([3000, 4000]);
  });
});
