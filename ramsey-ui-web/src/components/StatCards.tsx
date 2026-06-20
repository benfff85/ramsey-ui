import type { CampaignDto, ProgressionPointDto, LiveStageDto } from '../types';

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

export function StatCards({ current, first, liveStage }: {
  current: ProgressionPointDto; first: ProgressionPointDto; liveStage: LiveStageDto | null;
}) {
  // positive improvement = clique count dropped from the start of the campaign
  const improvement = first.cliqueCount - current.cliqueCount;
  return (
    <div className="statcards">
      <Stat label="Active Stage" value={`#${current.stageId}`} primary />
      <Stat label="Clique Count" value={fmt(current.cliqueCount)}
            sub={`${improvement >= 0 ? '−' : '+'}${fmt(Math.abs(improvement))} from start`}
            subClass={improvement >= 0 ? 'stat__sub--up' : 'stat__sub--down'} />
      <Stat label="Total Improvement" value={fmt(improvement)} />
      <Stat label="Progress" value={liveStage ? `${liveStage.progressPct.toFixed(1)}%` : '—'}
            sub={liveStage
              ? `${fmt(Math.min(liveStage.workIndex, liveStage.totalPairs))} / ${fmt(liveStage.totalPairs)}`
              : undefined} />
    </div>
  );
}
