import { useEffect, useRef, useState } from 'react';
import { Client } from '@stomp/stompjs';
import type { ThroughputSample } from './types';
import { api } from './api';
import { mergeSample } from './throughput';

const MAX_POINTS = 7200;

export function useThroughputSocket() {
  const [samples, setSamples] = useState<ThroughputSample[]>([]);
  const [connected, setConnected] = useState(false);
  const clientRef = useRef<Client | null>(null);

  useEffect(() => {
    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const client = new Client({ brokerURL: wsUrl, reconnectDelay: 3000 });

    client.onConnect = () => {
      setConnected(true);
      api.getThroughputHistory(MAX_POINTS).then(setSamples).catch(() => undefined);
      client.subscribe('/topic/throughput', (msg) => {
        const sample = JSON.parse(msg.body) as ThroughputSample;
        setSamples((prev) => mergeSample(prev, sample, MAX_POINTS));
      });
    };
    client.onWebSocketClose = () => setConnected(false);

    client.activate();
    clientRef.current = client;
    return () => { void client.deactivate(); };
  }, []);

  return { samples, connected };
}
