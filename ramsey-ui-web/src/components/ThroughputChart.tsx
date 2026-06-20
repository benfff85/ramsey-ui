import { useMemo } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import type { ThroughputSample } from '../types';
import { bucketSamples } from '../throughput';
import type { Interval } from './Sidebar';
import { Card } from './Card';

const fmtTime = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour12: false });
const fmtNum = (n: number) => Math.round(n).toLocaleString('en-US');

export function ThroughputChart({ samples, interval }: { samples: ThroughputSample[]; interval: Interval }) {
  const data = useMemo(() => bucketSamples(samples, interval), [samples, interval]);
  const latest = data.length ? data[data.length - 1].ups : 0;

  const title = <>Work units / sec <span className="dim">· {interval}s buckets</span></>;
  const badge = <span className="live-badge"><span className="live-badge__dot" />live</span>;

  return (
    <Card title={title} action={badge} hero>
      <div className="chart-headline" data-testid="ups-headline">
        {fmtNum(latest)}<span className="chart-headline__unit">u/s</span>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 8, right: 14, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="ups-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.42} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border-soft)" vertical={false} />
          <XAxis dataKey="t" tickFormatter={fmtTime} stroke="var(--faint)" tickLine={false}
                 minTickGap={56} fontSize={11} />
          <YAxis tickFormatter={fmtNum} stroke="var(--faint)" tickLine={false} axisLine={false}
                 width={56} fontSize={11} />
          <Tooltip
            contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--border)',
              borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            labelStyle={{ color: 'var(--muted)' }}
            labelFormatter={(t) => fmtTime(Number(t))}
            formatter={(v: number) => [`${fmtNum(v)} u/s`, 'Throughput']} />
          <Area type="monotone" dataKey="ups" stroke="var(--accent)" strokeWidth={2}
                fill="url(#ups-fill)" isAnimationActive={false} dot={false}
                activeDot={{ r: 4, fill: 'var(--accent)', stroke: 'none' }} />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}
