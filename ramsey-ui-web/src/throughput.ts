import type { ThroughputSample } from './types';

export interface Point { t: number; ups: number; }

export function bucketSamples(samples: ThroughputSample[], bucketSeconds: number): Point[] {
  if (bucketSeconds <= 1) {
    return samples.map((s) => ({ t: s.ts, ups: s.unitsPerSec }));
  }
  const sizeMs = bucketSeconds * 1000;
  const buckets = new Map<number, { sum: number; n: number }>();
  for (const s of samples) {
    const key = Math.floor(s.ts / sizeMs) * sizeMs;
    const b = buckets.get(key) ?? { sum: 0, n: 0 };
    b.sum += s.unitsPerSec;
    b.n += 1;
    buckets.set(key, b);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, b]) => ({ t, ups: b.sum / b.n }));
}

export function mergeSample(
  prev: ThroughputSample[], sample: ThroughputSample, maxPoints: number,
): ThroughputSample[] {
  const next = [...prev, sample];
  return next.length > maxPoints ? next.slice(next.length - maxPoints) : next;
}
