import { useEffect, useRef, useState } from 'react';
import { Client } from '@stomp/stompjs';
import type { ThroughputSample, LiveTick } from './types';
import { api } from './api';
import { mergeSample } from './throughput';

const MAX_POINTS = 7200;
// A campaign whose ticks stop arriving (banked/rotated away) goes "not live" after this long.
const STALE_MS = 10_000;

export interface CampaignLive {
  samples: ThroughputSample[];
  latest: LiveTick | null;
}

/**
 * One socket subscription carries ticks for EVERY active campaign (each tick is tagged with
 * its campaignId); this hook buckets them per campaign so the UI can show the live view of
 * whichever campaign is selected — not just whichever one the backend sampled first.
 */
export function useThroughputSocket() {
  const [byCampaign, setByCampaign] = useState<Record<number, CampaignLive>>({});
  const [connected, setConnected] = useState(false);
  const clientRef = useRef<Client | null>(null);

  useEffect(() => {
    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const client = new Client({ brokerURL: wsUrl, reconnectDelay: 3000 });

    client.onConnect = () => {
      setConnected(true);
      api.getThroughputHistory(MAX_POINTS).then((history) => {
        setByCampaign((prev) => {
          const next: Record<number, CampaignLive> = { ...prev };
          for (const s of history) {
            if (s.campaignId == null) continue;
            const cur = next[s.campaignId] ?? { samples: [], latest: null };
            next[s.campaignId] = { ...cur, samples: mergeSample(cur.samples, s, MAX_POINTS) };
          }
          return next;
        });
      }).catch(() => undefined);

      client.subscribe('/topic/throughput', (msg) => {
        const tick = JSON.parse(msg.body) as LiveTick;
        setByCampaign((prev) => {
          const next: Record<number, CampaignLive> = { ...prev };
          if (tick.campaignId != null) {
            const cur = next[tick.campaignId] ?? { samples: [], latest: null };
            next[tick.campaignId] = {
              samples: mergeSample(cur.samples,
                { ts: tick.ts, campaignId: tick.campaignId, stageId: tick.stageId, unitsPerSec: tick.unitsPerSec },
                MAX_POINTS),
              latest: tick,
            };
          }
          // expire "latest" for campaigns that stopped ticking (kept history stays charted)
          for (const key of Object.keys(next)) {
            const id = Number(key);
            const l = next[id].latest;
            if (l && tick.ts - l.ts > STALE_MS) next[id] = { ...next[id], latest: null };
          }
          return next;
        });
      });
    };
    client.onWebSocketClose = () => setConnected(false);

    client.activate();
    clientRef.current = client;
    return () => { void client.deactivate(); };
  }, []);

  return { byCampaign, connected };
}
