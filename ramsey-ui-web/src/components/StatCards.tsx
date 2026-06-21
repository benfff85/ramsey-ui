import type { CampaignDto } from '../types';

export function sortCampaigns(campaigns: CampaignDto[]): CampaignDto[] {
  const ts = (c: CampaignDto) => (c.updatedDate ? Date.parse(c.updatedDate) : 0);
  return [...campaigns].sort((a, b) => {
    const aActive = a.status === 'ACTIVE' ? 0 : 1;
    const bActive = b.status === 'ACTIVE' ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    if (ts(a) !== ts(b)) return ts(b) - ts(a);
    return b.campaignId - a.campaignId;
  });
}

const fmt = (n: number) => n.toLocaleString('en-US');

function Stat({ label, value, unit, sub, subClass, primary }: {
  label: string; value: string; unit?: string; sub?: string; subClass?: string; primary?: boolean;
}) {
  return (
    <div className={`stat${primary ? ' stat--primary' : ''}`}>
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}{unit && <span className="stat__unit">{unit}</span>}</div>
      {sub && <div className={`stat__sub${subClass ? ' ' + subClass : ''}`}>{sub}</div>}
    </div>
  );
}

export function StatCards({ stageId, cliqueCount, firstCliqueCount, progressPct, workIndex, totalPairs }: {
  stageId: number | null; cliqueCount: number | null; firstCliqueCount: number | null;
  progressPct: number | null; workIndex: number; totalPairs: number;
}) {
  // positive improvement = clique count dropped from the start of the campaign
  const improvement = (firstCliqueCount != null && cliqueCount != null) ? firstCliqueCount - cliqueCount : null;
  return (
    <div className="statcards">
      <Stat label="Active Stage" value={stageId != null ? `#${stageId}` : '—'} primary />
      <Stat label="Clique Count" value={cliqueCount != null ? fmt(cliqueCount) : '—'}
            sub={improvement != null ? `${improvement >= 0 ? '−' : '+'}${fmt(Math.abs(improvement))} from start` : undefined}
            subClass={improvement != null ? (improvement >= 0 ? 'stat__sub--up' : 'stat__sub--down') : undefined} />
      <Stat label="Total Improvement" value={improvement != null ? fmt(improvement) : '—'} />
      <Stat label="Progress" value={progressPct != null ? `${progressPct.toFixed(1)}%` : '—'}
            sub={totalPairs > 0 ? `${fmt(Math.min(workIndex, totalPairs))} / ${fmt(totalPairs)}` : undefined} />
    </div>
  );
}
