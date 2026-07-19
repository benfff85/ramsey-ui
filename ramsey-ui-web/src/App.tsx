import { useEffect, useState } from 'react';
import { api } from './api';
import { Sidebar, type Interval } from './components/Sidebar';
import { StatCards, sortCampaigns } from './components/StatCards';
import { ThroughputChart } from './components/ThroughputChart';
import { CliqueProgressionChart } from './components/CliqueProgressionChart';
import { CampaignOverlayChart } from './components/CampaignOverlayChart';
import { FleetPanel } from './components/FleetPanel';
import { ImprovementChart } from './components/ImprovementChart';
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

  // (Re)fetch progression on campaign change AND whenever the live stage advances, so the
  // charts/raw data pick up new stages without a manual reload.
  useEffect(() => {
    if (selectedId == null) return;
    api.getProgression(selectedId).then(setProgression).catch(() => undefined);
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
        {progression.length > 0 && (
          <div className="grid-2">
            <CliqueProgressionChart progression={progression} />
            <ImprovementChart progression={progression} />
          </div>
        )}
        <CampaignOverlayChart campaigns={campaigns} />
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
