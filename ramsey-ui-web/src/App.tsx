import { useEffect, useRef, useState } from 'react';

/**
 * Points to request for the progression charts. The full series is unbounded — it passed 80,000
 * points and 11 MB, which a phone cannot parse — and a chart a few hundred pixels wide cannot
 * show more than this anyway. The server samples structurally (kicks and epoch floors always
 * survive) and stamps each point's true position, so the axis and the ILS stage counts stay exact.
 */
const MAX_PROGRESSION_POINTS = 3000;
import { api } from './api';
import { Sidebar, type Interval } from './components/Sidebar';
import { StatCards, sortCampaigns } from './components/StatCards';
import { ThroughputChart } from './components/ThroughputChart';
import { CliqueProgressionChart } from './components/CliqueProgressionChart';
import { FleetPanel } from './components/FleetPanel';
import { PerturbationPanel } from './components/PerturbationPanel';
import { BestResultsTable } from './components/BestResultsTable';
import { RawDataTable } from './components/RawDataTable';
import { useThroughputSocket } from './useThroughputSocket';
import type { CampaignDto, ProgressionPointDto, BestResultDto } from './types';

export default function App() {
  const [campaigns, setCampaigns] = useState<CampaignDto[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [progression, setProgression] = useState<ProgressionPointDto[]>([]);
  const [bestResults, setBestResults] = useState<BestResultDto[]>([]);
  const [interval, setIntervalSec] = useState<Interval>(5);
  const [collapsed, setCollapsed] = useState(false);
  const { byCampaign, connected } = useThroughputSocket();

  // Live view of the SELECTED campaign only — with several campaigns active, the socket
  // carries per-campaign ticks and each campaign has its own live state.
  const live = selectedId != null ? byCampaign[selectedId] : undefined;
  const latest = live?.latest ?? null;
  const samples = live?.samples ?? [];

  // The selected campaign's active stage reported by the live socket — drives transitions.
  const liveStageId = latest?.stageId ?? null;

  useEffect(() => {
    api.getCampaigns().then((cs) => {
      setCampaigns(cs);
      const sorted = sortCampaigns(cs);
      if (sorted.length) setSelectedId(sorted[0].campaignId);
    }).catch(() => undefined);
  }, []);

  // Progression is append-only and unbounded — a long-running campaign is already tens of
  // thousands of points and several megabytes. It has to stay current as stages advance, but a
  // descent advances more than once a second, so refetching the whole series each time moved
  // megabytes per second. Fetch it once per campaign, then only the tail.
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

  useEffect(() => {
    const since = highestStageIdRef.current;
    if (selectedId == null || liveStageId == null || since == null) return;
    let alive = true;
    api.getProgression(selectedId, since).then((points) => {
      if (!alive || !points.length) return;
      highestStageIdRef.current = points.reduce((m, p) => Math.max(m, p.stageId), since);
      // Dedupe by stage: two advances in quick succession can leave overlapping deltas in flight,
      // since the cursor only moves when a response lands.
      setProgression((prev) => {
        const seen = new Set(prev.map((p) => p.stageId));
        const fresh = points.filter((p) => !seen.has(p.stageId));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [selectedId, liveStageId]);

  // Best-results for the live stage; polled and re-keyed when the stage changes.
  useEffect(() => {
    if (liveStageId == null) { setBestResults([]); return; }
    let alive = true;
    const tick = () => api.getLiveStage(liveStageId).then((d) => { if (alive) setBestResults(d.bestResults); }).catch(() => undefined);
    tick();
    const h = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(h); };
  }, [liveStageId]);

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
  const progressPct = latest?.progressPct ?? null;
  const workIndex = latest?.workIndex ?? 0;
  const totalPairs = latest?.totalPairs ?? 0;

  return (
    <div className={`app${collapsed ? ' is-collapsed' : ''}`}>
      <Sidebar campaigns={campaigns} selectedId={selectedId} onSelect={setSelectedId}
               interval={interval} onIntervalChange={setIntervalSec}
               lastUpdated={new Date().toLocaleTimeString()} connected={connected}
               collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)} />
      <main className="main">
        <StatCards stageId={stageId} cliqueCount={cliqueCount} minCliqueCount={minCliqueCount} firstCliqueCount={firstCliqueCount}
                   progressPct={progressPct} workIndex={workIndex} totalPairs={totalPairs} />
        <FleetPanel />
        <ThroughputChart samples={samples} interval={interval} />
        {progression.length > 0 && <PerturbationPanel progression={progression} />}
        {progression.length > 0 && (
          <div className="grid-2">
            <CliqueProgressionChart progression={progression} />
          </div>
        )}
        {progression.length > 0 && (
          <>
            <BestResultsTable bestResults={bestResults} currentClique={cliqueCount ?? 0} />
            <RawDataTable progression={progression} />
          </>
        )}
      </main>
    </div>
  );
}
