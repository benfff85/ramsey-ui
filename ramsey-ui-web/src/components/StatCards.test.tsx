import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCards, sortCampaigns } from './StatCards';
import type { CampaignDto } from '../types';

const camp = (id: number, status: string, updated: string): CampaignDto => ({
  campaignId: id, subgraphSize: 8, vertexCount: 281, totalPairs: 600,
  strategy: 'S', status, createdDate: updated, updatedDate: updated,
});

describe('sortCampaigns', () => {
  it('puts ACTIVE first, then newest updatedDate', () => {
    const out = sortCampaigns([
      camp(1, 'INACTIVE', '2026-06-10T00:00:00'),
      camp(2, 'INACTIVE', '2026-06-18T00:00:00'),
      camp(3, 'ACTIVE', '2026-06-01T00:00:00'),
    ]);
    expect(out.map((c) => c.campaignId)).toEqual([3, 2, 1]);
  });
});

describe('StatCards', () => {
  it('renders live stage, clique count and progress', () => {
    render(<StatCards stageId={42} cliqueCount={775623} minCliqueCount={775623} firstCliqueCount={800000}
                      progressPct={50} workIndex={300} totalPairs={600} />);
    expect(screen.getByText('#42')).toBeInTheDocument();
    expect(screen.getAllByText('775,623').length).toBe(2); // current + campaign min
    expect(screen.getByText('50.0%')).toBeInTheDocument();
    expect(screen.getByText('24,377')).toBeInTheDocument(); // total improvement = 800000 - 775623
  });

  it('shows the campaign min with "at campaign best" when the live count sits on the floor', () => {
    render(<StatCards stageId={42} cliqueCount={25840} minCliqueCount={25840} firstCliqueCount={27401}
                      progressPct={10} workIndex={1} totalPairs={10} />);
    expect(screen.getByText('at campaign best')).toBeInTheDocument();
  });

  it('shows how far the live count drifted above the campaign min', () => {
    render(<StatCards stageId={42} cliqueCount={26007} minCliqueCount={25881} firstCliqueCount={27104}
                      progressPct={10} workIndex={1} totalPairs={10} />);
    expect(screen.getByText('25,881')).toBeInTheDocument();
    expect(screen.getByText('+126 above min')).toBeInTheDocument();
  });

  it('shows placeholders before any data', () => {
    render(<StatCards stageId={null} cliqueCount={null} minCliqueCount={null} firstCliqueCount={null}
                      progressPct={null} workIndex={0} totalPairs={0} />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
