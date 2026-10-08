import { useEffect, useRef, useState } from 'react';

/**
 * Points to request for the progression charts. The full series is unbounded — it passed 3.66M
 * points and 555 MB in Oct 2026, and the server no longer serves it — and a chart a few hundred
 * pixels wide cannot show more than this anyway. The server samples structurally (kicks and
 * epoch floors always survive) and stamps each point's true position, so the axis and the ILS
 * stage counts stay exact.
 */
const MAX_PROGRESSION_POINTS = 3000;

/**
 * How often the progression charts fetch new stages. They used to append on every stage change the
 * socket reported, which at 7+ stages a second meant a fetch and a re-render of thousands of points
 * about once a second, for charts whose shape cannot change visibly that fast.
 */
const PROGRESSION_REFRESH_MS = 30_000;
import { api } from './api';
import { Sidebar, type Interval } from './components/Sidebar';
import { StatCards, sortCampaigns } from './components/StatCards';
import { ThroughputChart } from './components/ThroughputChart';
import { CliqueProgressionChart } from './components/CliqueProgressionChart';
import { FleetPanel } from './components/FleetPanel';
import { PerturbationPanel } from './components/PerturbationPanel';
import { useThroughputSocket } from './useThroughputSocket';
import type { CampaignDto, ProgressionPointDto } from './types';

export default function App() {
  const [campaigns, setCampaigns] = useState<CampaignDto[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [progression, setProgression] = useState<ProgressionPointDto[]>([]);
  const [interval, setIntervalSec] = useState<Interval>(5);
  const [collapsed, setCollapsed] = useState(false);
  const { byCampaign, connected } = useThroughputSocket();

  // Live view of the SELECTED campaign only — with several campaigns active, the socket
  // carries per-campaign ticks and each campaign has its own live state.
  const live = selectedId != null ? byCampaign[selectedId] : undefined;
  const latest = live?.latest ?? null;
  const samples = live?.samples ?? [];

  useEffect(() => {
    api.getCampaigns().then((cs) => {
      setCampaigns(cs);
      const sorted = sortCampaigns(cs);
      if (sorted.length) setSelectedId(sorted[0].campaignId);
    }).catch(() => undefined);
  }, []);

  // Progression is append-only and unbounded, and the fleet advances several stages a second.
  // Fetch a sample once per campaign, then only the tail.
  const highestStageIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (selectedId == null) return;
    let alive = true;
    highestStageIdRef.current = null;
    setProgression([]);
    api.getProgression(selectedId, undefined, MAX_PROGRESSION_POINTS).then((points) => {
      if (!alive) return;
      setProgression(points);
      highestStageIdRef.current = points.reduce((m, p) => Math.max(m, p.stageId), 0) || null;
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [selectedId]);

  // Read by the tail effect without re-running it on every append.
  const heldPointsRef = useRef(0);
  heldPointsRef.current = progression.length;

  // Fetch only the tail, on a timer rather than per stage advance (see PROGRESSION_REFRESH_MS).
  useEffect(() => {
    if (selectedId == null) return;
    let alive = true;
    const refresh = () => {
      const since = highestStageIdRef.current;
      if (since == null) return;
      // Appending grows the held series without bound in a tab left open. Once it doubles past
      // the sample size, take a fresh sample instead: it runs through the server's newest point,
      // so it also covers the tail.
      if (heldPointsRef.current > 2 * MAX_PROGRESSION_POINTS) {
        api.getProgression(selectedId, undefined, MAX_PROGRESSION_POINTS).then((points) => {
          if (!alive || !points.length) return;
          setProgression(points);
          highestStageIdRef.current = points.reduce((m, p) => Math.max(m, p.stageId), since);
        }).catch(() => undefined);
        return;
      }
      api.getProgression(selectedId, since).then((points) => {
        if (!alive || !points.length) return;
        highestStageIdRef.current = points.reduce((m, p) => Math.max(m, p.stageId), since);
        // Dedupe by stage: a slow response can overlap the next refresh's.
        setProgression((prev) => {
          const seen = new Set(prev.map((p) => p.stageId));
          const fresh = points.filter((p) => !seen.has(p.stageId));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
      }).catch(() => undefined);
    };
    const h = setInterval(refresh, PROGRESSION_REFRESH_MS);
    return () => { alive = false; clearInterval(h); };
  }, [selectedId]);

  const sortedProg = [...progression].sort((a, b) => a.stageId - b.stageId);
  const fallbackCurrent = sortedProg[sortedProg.length - 1];
  const firstCliqueCount = sortedProg.length ? sortedProg[0].cliqueCount : null;

  // Live scalars come from the socket; fall back to progression before the first tick arrives.
  const stageId = latest?.stageId ?? fallbackCurrent?.stageId ?? null;
  const cliqueCount = latest?.cliqueCount ?? fallbackCurrent?.cliqueCount ?? null;

  // The campaign's own floor: min over every stage it has produced (plus the live count,
  // in case the current stage is a fresh record the progression fetch hasn't caught up to).
  const progMin = sortedProg.reduce<number | null>(
    (m, p) => (m == null || p.cliqueCount < m ? p.cliqueCount : m), null);
  const minCliqueCount = progMin == null ? cliqueCount
    : cliqueCount == null ? progMin : Math.min(progMin, cliqueCount);

  return (
    <div className={`app${collapsed ? ' is-collapsed' : ''}`}>
      <Sidebar campaigns={campaigns} selectedId={selectedId} onSelect={setSelectedId}
               interval={interval} onIntervalChange={setIntervalSec}
               lastUpdated={new Date().toLocaleTimeString()} connected={connected}
               collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)} />
      <main className="main">
        <StatCards stageId={stageId} cliqueCount={cliqueCount} minCliqueCount={minCliqueCount} firstCliqueCount={firstCliqueCount} />
        <FleetPanel />
        <ThroughputChart samples={samples} interval={interval} />
        {progression.length > 0 && <PerturbationPanel progression={progression} />}
        {progression.length > 0 && (
          <div className="grid-2">
            <CliqueProgressionChart progression={progression} />
          </div>
        )}
      </main>
    </div>
  );
}
