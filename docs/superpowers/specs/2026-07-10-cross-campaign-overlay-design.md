# Cross-campaign basin-descent overlay — design

**Date:** 2026-07-10 · **Approved by:** Ben ("Go") · **Scope:** frontend-only (ramsey-ui-web)

## Purpose

One chart that overlays every eligible campaign's descent so basin behavior can be
compared at a glance: how fast each seed front-loads, where it walls, whether late
waves (opt_2-style) appear, and how run duration affects the banked floor. Mirrors
the offline matplotlib overlay produced during the multi-seed basin program.

## What it is

A full-width card, **"Basin descent — all campaigns"**, on the main dashboard below
the per-campaign chart pair, always visible regardless of sidebar selection.
Recharts `LineChart`: **X = stage # within campaign** (1-based sequence, not global
stageId), **Y = clique count**.

## Campaign eligibility

`vertexCount === 282 && campaignId >= 10`, computed from the already-fetched
campaigns list. If more than 8 qualify, keep the 8 highest campaignIds and caption
"latest 8" (the palette has 8 fixed slots; hues are never cycled).

## Lines

Per campaign, two lines:

- **Running minimum** — bold (`strokeWidth 2`), `type="stepAfter"`, computed from
  the full progression; stored as change-points only (+ final point) with
  `connectNulls`.
- **Raw stage bases** — same hue, `strokeOpacity 0.25`, `strokeWidth 1`,
  downsampled by stride to ≤ 600 points (first and last always kept).

Colors: 8 new `--series-1..8` vars in `theme.css` (dataviz reference dark palette,
validated against panel surface `#111726`: all ≥ 3:1, worst adjacent CVD ΔE 10.3 —
floor band, relieved by the labeled legend). Slots assigned by campaignId rank
ascending among eligible campaigns — stable as campaigns are added.

## X-axis clipping (the c10 squash problem)

If the longest campaign exceeds **2×** the runner-up, clip the X axis at
`ceil(runnerUp × 1.1)` and caption "cN clipped at X stages (floor unchanged)".
Generic — no hardcoded campaign id. Running min is computed before clipping, so
the legend floor value is always the true floor.

## Legend & hover

Custom legend row (not recharts `Legend`): color swatch + `c{id}` + floor value +
a "live" badge for ACTIVE campaigns. This doubles as the direct-label relief
required by the palette validation. Shared-x tooltip shows running-min entries
only; raw lines are filtered out by a custom tooltip content component.

## Data flow

Self-contained component: receives the campaigns list as a prop, fetches all
eligible progressions in parallel (`api.getProgression`) on mount and re-polls
every 60 s. Campaigns with empty progressions are skipped. No backend change;
no change to App's selected-campaign plumbing beyond rendering the card.

## Testing

Vitest on pure transforms in `overlay.ts`: eligibility filter, running-min
change-point extraction, stride downsample (keeps first/last, respects target),
clip rule (only fires when longest > 2× runner-up), stable slot assignment.
Component smoke test. Then the established deploy pattern: local image build,
force-recreate `ramsey-ui` container, screenshot-verify at :36003, PR for review.
