import { useEffect, useState } from 'react';
import { api } from './api';
import { Sidebar, type Interval } from './components/Sidebar';
import { StatCards, sortCampaigns } from './components/StatCards';
import { useThroughputSocket } from './useThroughputSocket';
import type { CampaignDto, ProgressionPointDto, LiveStageDto } from './types';

export default function App() {
  const [campaigns, setCampaigns] = useState<CampaignDto[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [progression, setProgression] = useState<ProgressionPointDto[]>([]);
  const [liveStage, setLiveStage] = useState<LiveStageDto | null>(null);
  const [interval, setIntervalSec] = useState<Interval>(5);
  const { samples, connected } = useThroughputSocket();

  useEffect(() => {
    api.getCampaigns().then((cs) => {
      setCampaigns(cs);
      const sorted = sortCampaigns(cs);
      if (sorted.length) setSelectedId(sorted[0].campaignId);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (selectedId == null) return;
    api.getProgression(selectedId).then(setProgression).catch(() => undefined);
  }, [selectedId]);

  const sortedProg = [...progression].sort((a, b) => a.stageId - b.stageId);
  const activeStage = progression.find((p) => p.status === 'ACTIVE') ?? null;

  useEffect(() => {
    if (!activeStage) { setLiveStage(null); return; }
    let alive = true;
    const tick = () => api.getLiveStage(activeStage.stageId).then((d) => { if (alive) setLiveStage(d); }).catch(() => undefined);
    tick();
    const h = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(h); };
  }, [activeStage?.stageId]);

  const latestUps = samples.length ? samples[samples.length - 1].unitsPerSec : 0;
  const current = sortedProg[sortedProg.length - 1];
  const first = sortedProg[0];

  return (
    <div className="app">
      <Sidebar campaigns={campaigns} selectedId={selectedId} onSelect={setSelectedId}
               interval={interval} onIntervalChange={setIntervalSec}
               lastUpdated={new Date().toLocaleTimeString()} connected={connected} />
      <main className="main">
        {current && first && (
          <StatCards current={current} first={first} liveStage={liveStage} unitsPerSec={latestUps} />
        )}
        {/* throughput hero (Task 11) and historical charts + tables (Task 12) mount here */}
      </main>
    </div>
  );
}
