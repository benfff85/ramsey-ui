import { describe, it, expect } from 'vitest';
import { bucketSamples, mergeSample } from './throughput';
import type { ThroughputSample } from './types';

const s = (ts: number, ups: number): ThroughputSample => ({ ts, stageId: 1, unitsPerSec: ups });

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
