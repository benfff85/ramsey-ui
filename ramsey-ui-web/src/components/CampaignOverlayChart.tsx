import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { api } from '../api';
import { clipLimit, downsample, eligibleCampaigns, runningMin, seriesSlots, SERIES_SLOT_COUNT } from '../overlay';
import type { CampaignDto, ProgressionPointDto } from '../types';
import { Card } from './Card';

const RAW_TARGET = 600;
const POLL_MS = 60_000;
const fmtNum = (n: number) => n.toLocaleString('en-US');

type Row = { seq: number } & Record<string, number>;

interface SeriesMeta { id: number; color: string; floor: number; live: boolean; clipped: boolean; }

function buildChart(eligible: CampaignDto[], progs: Record<number, ProgressionPointDto[]>) {
  const withData = eligible.filter((c) => (progs[c.campaignId] ?? []).length > 0);
  const slots = seriesSlots(withData.map((c) => c.campaignId));
  const limit = clipLimit(withData.map((c) => progs[c.campaignId].length));

  const rows = new Map<number, Row>();
  const row = (seq: number): Row => {
    let r = rows.get(seq);
    if (!r) { r = { seq } as Row; rows.set(seq, r); }
    return r;
  };

  const meta: SeriesMeta[] = withData.map((c) => {
    const points = progs[c.campaignId];
    const min = runningMin(points);
    const raw = downsample(points, RAW_TARGET);
    const floor = min[min.length - 1].clique;
    const clipped = limit != null && points.length > limit;
    const minShown = clipped ? min.filter((p) => p.seq <= limit) : min;
    const rawShown = clipped ? raw.filter((p) => p.seq <= limit) : raw;
    // extend a clipped floor line to the clip edge so it doesn't stop mid-chart
    const lastMin = minShown[minShown.length - 1];
    if (clipped && lastMin && lastMin.seq !== limit) minShown.push({ seq: limit, clique: lastMin.clique });
    minShown.forEach((p) => { row(p.seq)[`min${c.campaignId}`] = p.clique; });
    rawShown.forEach((p) => { row(p.seq)[`raw${c.campaignId}`] = p.clique; });
    return {
      id: c.campaignId,
      color: `var(--series-${slots.get(c.campaignId)})`,
      floor,
      live: c.status === 'ACTIVE',
      clipped,
    };
  });

  const data = [...rows.values()].sort((a, b) => a.seq - b.seq);
  return { data, meta, limit };
}

function OverlayTooltip({ active, payload, label, meta }: {
  active?: boolean; payload?: { dataKey?: string | number; value?: number | string }[];
  label?: number; meta: SeriesMeta[];
}) {
  if (!active || !payload?.length) return null;
  const mins = payload.filter((p) => String(p.dataKey).startsWith('min'));
  if (!mins.length) return null;
  return (
    <div className="overlay-tip">
      <div className="overlay-tip__label">stage {label}</div>
      {mins.map((p) => {
        const id = Number(String(p.dataKey).slice(3));
        const m = meta.find((x) => x.id === id);
        return (
          <div key={String(p.dataKey)} style={{ color: m?.color }}>
            c{id} · {fmtNum(Number(p.value))}
          </div>
        );
      })}
    </div>
  );
}

export function CampaignOverlayChart({ campaigns }: { campaigns: CampaignDto[] }) {
  const eligible = useMemo(() => eligibleCampaigns(campaigns), [campaigns]);
  const eligibleKey = eligible.map((c) => c.campaignId).join(',');
  const [progs, setProgs] = useState<Record<number, ProgressionPointDto[]>>({});

  useEffect(() => {
    if (!eligible.length) return;
    let alive = true;
    const fetchAll = () =>
      Promise.all(eligible.map(async (c) => [c.campaignId, await api.getProgression(c.campaignId)] as const))
        .then((entries) => { if (alive) setProgs(Object.fromEntries(entries)); })
        .catch(() => undefined);
    fetchAll();
    const h = setInterval(fetchAll, POLL_MS);
    return () => { alive = false; clearInterval(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleKey]);

  const { data, meta, limit } = useMemo(() => buildChart(eligible, progs), [eligibleKey, progs]);
  if (!meta.length) return null;

  const clippedIds = meta.filter((m) => m.clipped).map((m) => `c${m.id}`);
  const captions: string[] = [];
  if (limit != null && clippedIds.length) captions.push(`${clippedIds.join(', ')} clipped at ${fmtNum(limit)} stages (floor unchanged)`);
  if (eligible.length === SERIES_SLOT_COUNT) captions.push(`latest ${SERIES_SLOT_COUNT} campaigns`);

  return (
    <Card title="Basin descent — all campaigns"
          action={captions.length ? <span className="overlay-caption">{captions.join(' · ')}</span> : undefined}>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 8, right: 14, bottom: 16, left: 4 }}>
          <CartesianGrid stroke="var(--border-soft)" vertical={false} />
          <XAxis dataKey="seq" type="number" domain={[1, 'dataMax']} stroke="var(--faint)"
                 tickLine={false} minTickGap={40} fontSize={11}
                 label={{ value: 'stage # within campaign', position: 'bottom', offset: 2,
                          fill: 'var(--faint)', fontSize: 11 }} />
          <YAxis tickFormatter={fmtNum} stroke="var(--faint)" tickLine={false} axisLine={false}
                 width={64} fontSize={11} domain={['auto', 'auto']} />
          <Tooltip content={<OverlayTooltip meta={meta} />} />
          {meta.map((m) => (
            <Line key={`raw${m.id}`} dataKey={`raw${m.id}`} type="monotone" connectNulls
                  stroke={m.color} strokeWidth={1} strokeOpacity={0.25}
                  dot={false} activeDot={false} isAnimationActive={false} />
          ))}
          {meta.map((m) => (
            <Line key={`min${m.id}`} dataKey={`min${m.id}`} type="stepAfter" connectNulls
                  stroke={m.color} strokeWidth={2} dot={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="overlay-legend" data-testid="overlay-legend">
        {meta.map((m) => (
          <span key={m.id} className="overlay-legend__item">
            <span className="overlay-legend__swatch" style={{ background: m.color }} />
            c{m.id} · {fmtNum(m.floor)}
            {m.live && <span className="overlay-legend__live">live</span>}
          </span>
        ))}
      </div>
    </Card>
  );
}
