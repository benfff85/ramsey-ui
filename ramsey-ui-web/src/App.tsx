import { useEffect, useState } from 'react';
import { api } from './api';
import { Sidebar, type Interval } from './components/Sidebar';
import { StatCards, sortCampaigns } from './components/StatCards';
import { ThroughputChart } from './components/ThroughputChart';
import { CliqueProgressionChart } from './components/CliqueProgressionChart';
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
  const { samples, latest, connected } = useThroughputSocket();

  // The active stage reported by the live socket — drives transitions, not a stale fetch.
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
  const progressPct = latest?.progressPct ?? null;
  const workIndex = latest?.workIndex ?? 0;
  const totalPairs = latest?.totalPairs ?? 0;

  return (
    <div className="app">
      <Sidebar campaigns={campaigns} selectedId={selectedId} onSelect={setSelectedId}
               interval={interval} onIntervalChange={setIntervalSec}
               lastUpdated={new Date().toLocaleTimeString()} connected={connected} />
      <main className="main">
        <StatCards stageId={stageId} cliqueCount={cliqueCount} firstCliqueCount={firstCliqueCount}
                   progressPct={progressPct} workIndex={workIndex} totalPairs={totalPairs} />
        <ThroughputChart samples={samples} interval={interval} />
        {progression.length > 0 && (
          <>
            <div className="grid-2">
              <CliqueProgressionChart progression={progression} />
              <ImprovementChart progression={progression} />
            </div>
            <BestResultsTable bestResults={bestResults} currentClique={cliqueCount ?? 0} />
            <RawDataTable progression={progression} />
          </>
        )}
      </main>
    </div>
  );
}
