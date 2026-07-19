import { useEffect, useState } from 'react';
import { api } from '../api';
import type { FleetDto } from '../types';
import { Card } from './Card';

const POLL_MS = 10_000;

/**
 * Fleet → campaign → status readout. The fleet mapping (fleet abstraction) is the
 * live control surface: which platform's workers process which campaign, and
 * whether they're RUNNING or PAUSED. Repointing/pausing is a DB/API update, not
 * a redeploy — this panel makes the current state visible.
 */
export function FleetPanel() {
  const [fleets, setFleets] = useState<FleetDto[]>([]);

  useEffect(() => {
    let alive = true;
    const tick = () => api.getFleets().then((f) => { if (alive) setFleets(f); }).catch(() => undefined);
    tick();
    const h = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(h); };
  }, []);

  if (fleets.length === 0) return null;
  const sorted = [...fleets].sort((a, b) => a.platform.localeCompare(b.platform));

  return (
    <Card title="Fleets">
      <div className="fleets" data-testid="fleet-panel">
        {sorted.map((f) => {
          const paused = f.status === 'PAUSED';
          const idle = f.campaignId == null;
          const state = paused ? 'paused' : idle ? 'idle' : 'running';
          return (
            <div key={f.platform} className="fleet-row">
              <span className="fleet-row__platform">{f.platform}</span>
              <span className="fleet-row__target">
                {idle ? '—' : <>campaign <strong>{f.campaignId}</strong></>}
              </span>
              <span className={`fleet-row__state fleet-row__state--${state}`}>{state}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
