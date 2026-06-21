import { useEffect, useRef, useState } from 'react';
import { Client } from '@stomp/stompjs';
import type { ThroughputSample, LiveTick } from './types';
import { api } from './api';
import { mergeSample } from './throughput';

const MAX_POINTS = 7200;

export function useThroughputSocket() {
  const [samples, setSamples] = useState<ThroughputSample[]>([]);
  const [latest, setLatest] = useState<LiveTick | null>(null);
  const [connected, setConnected] = useState(false);
  const clientRef = useRef<Client | null>(null);

  useEffect(() => {
    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const client = new Client({ brokerURL: wsUrl, reconnectDelay: 3000 });

    client.onConnect = () => {
      setConnected(true);
      api.getThroughputHistory(MAX_POINTS).then(setSamples).catch(() => undefined);
      client.subscribe('/topic/throughput', (msg) => {
        const tick = JSON.parse(msg.body) as LiveTick;
        setLatest(tick);
        setSamples((prev) =>
          mergeSample(prev, { ts: tick.ts, stageId: tick.stageId, unitsPerSec: tick.unitsPerSec }, MAX_POINTS));
      });
    };
    client.onWebSocketClose = () => setConnected(false);

    client.activate();
    clientRef.current = client;
    return () => { void client.deactivate(); };
  }, []);

  return { samples, latest, connected };
}
