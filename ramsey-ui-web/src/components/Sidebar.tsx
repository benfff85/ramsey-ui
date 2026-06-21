import type { CampaignDto } from '../types';
import { sortCampaigns } from './StatCards';

export type Interval = 1 | 5 | 30;

export function Sidebar({ campaigns, selectedId, onSelect, interval, onIntervalChange, lastUpdated, connected, collapsed, onToggleCollapse }: {
  campaigns: CampaignDto[]; selectedId: number | null; onSelect: (id: number) => void;
  interval: Interval; onIntervalChange: (i: Interval) => void; lastUpdated: string; connected: boolean;
  collapsed: boolean; onToggleCollapse: () => void;
}) {
  const sorted = sortCampaigns(campaigns);
  return (
    <aside className="sidebar">
      <button className="sidebar__toggle" onClick={onToggleCollapse}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}>
        {collapsed ? '»' : '«'}
      </button>
      <div className="sidebar__brand">
        <div className="sidebar__mark">RAM<span>SEY</span></div>
        <div className="sidebar__sub">search telemetry</div>
      </div>

      <label className="field">
        <span className="field__label">Campaign</span>
        <select value={selectedId ?? ''} onChange={(e) => onSelect(Number(e.target.value))}>
          {sorted.map((c) => (
            <option key={c.campaignId} value={c.campaignId}>
              #{c.campaignId} — {c.vertexCount}v / k={c.subgraphSize} ({c.status})
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span className="field__label">Live interval</span>
        <div className="segmented" role="group" aria-label="Live update interval">
          {([1, 5, 30] as Interval[]).map((i) => (
            <button key={i} className={i === interval ? 'is-active' : ''} aria-pressed={i === interval}
                    onClick={() => onIntervalChange(i)}>{i}s</button>
          ))}
        </div>
      </div>

      <div className="rail-spacer" />
      <div className="status">
        <span className={`status__dot ${connected ? 'status__dot--ok' : 'status__dot--off'}`} />
        {connected ? 'Live · streaming' : 'Reconnecting…'}
      </div>
      <div className="sidebar__updated">synced {lastUpdated}</div>
    </aside>
  );
}
