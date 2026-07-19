import type { ProgressionPointDto } from '../types';
import { analyzeIls, WALL_STAGES, BASE_EDGE_PAIRS } from '../ils';
import { Card } from './Card';

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * Iterated-local-search status: how many kicks have fired, where the current basin
 * floored versus the incumbent, and a countdown to the next kick (500 stages since the
 * last one). Self-hides for campaigns with no kicks. All derived from the progression
 * series (see analyzeIls) — no extra backend call.
 */
export function PerturbationPanel({ progression }: { progression: ProgressionPointDto[] }) {
  const ils = analyzeIls(progression);
  if (!ils) return null;

  const { kickCount, incumbent, basinFloor, nextKickIn, stagesSinceKick, nextMultiplier, etaHours } = ils;
  const pct = Math.min(100, (stagesSinceKick / WALL_STAGES) * 100);
  const floorDelta = basinFloor != null ? basinFloor - incumbent : null;
  const flips = BASE_EDGE_PAIRS * nextMultiplier;
  const eta = etaHours == null ? null
    : etaHours < 1 ? `~${Math.max(1, Math.round(etaHours * 60))}m`
    : `~${etaHours.toFixed(1)}h`;

  return (
    <Card title="Perturbation (ILS)">
      <div className="ils">
        <div className="ils__stats">
          <div className="ils__stat">
            <span className="ils__k">kicks fired</span>
            <span className="ils__v">{kickCount}</span>
          </div>
          <div className="ils__stat">
            <span className="ils__k">incumbent (best)</span>
            <span className="ils__v">{fmt(incumbent)}</span>
          </div>
          <div className="ils__stat">
            <span className="ils__k">current basin floor</span>
            <span className="ils__v">
              {basinFloor != null ? fmt(basinFloor) : '—'}
              {floorDelta != null && (
                <span className={`ils__delta ils__delta--${floorDelta <= 0 ? 'good' : 'over'}`}>
                  {floorDelta <= 0 ? 'matched' : `+${fmt(floorDelta)}`}
                </span>
              )}
            </span>
          </div>
          <div className="ils__stat">
            <span className="ils__k">next kick strength</span>
            <span className="ils__v">×{nextMultiplier} · {flips}+{flips} flips</span>
          </div>
        </div>
        <div className="ils__next">
          <div className="ils__nextlabel">
            <span>next kick in <strong>{fmt(nextKickIn)}</strong> stages{eta ? ` · ${eta}` : ''}</span>
            <span className="ils__muted">{fmt(stagesSinceKick)} / {fmt(WALL_STAGES)} stages walled</span>
          </div>
          <div className="ils__bar"><div className="ils__barfill" style={{ width: `${pct}%` }} /></div>
        </div>
      </div>
    </Card>
  );
}
