# Design: ramsey-ui rewrite → React + Spring Boot

- **Date:** 2026-06-20
- **Status:** Approved (architecture); pending spec review
- **Branch:** `feature/react-springboot-ui-rewrite`

## Context

`ramsey-ui` is currently a single Streamlit `app.py` that auto-refreshes every 30s.
It reads the ramsey-mw REST API (campaigns, progression) and reads Redis directly
(`processed_count`, `stage_work_index`, `stage_config`, `best_results`). Throughput
("work units/sec") is approximated by diffing `processed_count` across page refreshes,
so it is coarse (≥5s, ~30s cadence) and keeps **no history** — there is no live graph
of speed over time.

This rewrite replaces Streamlit with a React frontend + Spring Boot backend, adds a
real-time throughput graph fed over WebSocket, and keeps full feature parity with the
current dashboard.

## Goals

- Multi-module Maven project in the `ramsey-ui` repo: `ramsey-ui-web` (React) +
  `ramsey-ui-rest` (Spring Boot).
- Spring Boot samples work-units/sec on a time-series basis and pushes updates to all
  connected UI instances over WebSocket for real-time refresh.
- A live **work-units/sec** graph with history, where the graph's update/aggregation
  cadence is user-selectable in the UI (1s / 5s / 30s).
- Full parity with the current Streamlit views (campaign selector, clique-count
  progression chart, improvement-per-stage chart, stage progress, best-novel-results
  table, raw data).
- Cleaner, prettier presentation than default Streamlit.

## Non-goals / Out of scope

- No changes to ramsey-mw, ramsey-queue-manager, or ramsey-worker-rust. The new backend
  is **read-only**; mw still owns all writes/persistence.
- No persistent throughput history — in-memory rolling window only (resets on restart).
- No authentication (internal tool, unchanged from today).
- No Portainer/production deploy as part of this work. Compose is edited locally only;
  any deploy happens later, with explicit confirmation.

## Architecture

```
ramsey-ui/                 parent pom (packaging=pom)
├── ramsey-ui-rest/        Spring Boot 4.1.0 / Java 25 — BFF + WebSocket + sampler
└── ramsey-ui-web/         React + TypeScript (Vite) — built by Maven, bundled into -rest
```

**Single deployable.** During `mvn package`, `ramsey-ui-web` is built via
frontend-maven-plugin (`npm ci && npm run build`) and its `dist/` is copied into
`ramsey-ui-rest`'s static resources. The resulting Spring Boot jar serves the SPA **and**
the REST/WebSocket endpoints on a single port. One container replaces the Streamlit one.

(Considered and rejected: two containers + nginx for the SPA — more moving parts than an
internal dashboard warrants.)

## Backend — `ramsey-ui-rest`

Read-only aggregator. Mirrors the current app's two data sources; never writes.

- **Redis directly** (Spring Data Redis, `StringRedisTemplate`) for live counters:
  `processed_count:{stageId}`, `stage_work_index:{stageId}`, `stage_config:{stageId}`
  (→ `totalPairs`), `best_results:{stageId}` (sorted set, novel-only).
- **mw REST** (`API_BASE_URL`, default `http://ramsey-mw:8080`) for campaigns +
  progression (MySQL-backed history). Use a `RestClient`.

### Active-stage resolution

The sampler must know which stage workers are processing. Resolve it as:
ACTIVE campaign → its ACTIVE stage (from mw progression). Cache the result and refresh
every ~5s. This naturally follows stage/campaign transitions. If no active stage exists,
emit `unitsPerSec = 0`.

### Time-series sampler

A `@Scheduled(fixedRate = 1000ms)` task:

1. `activeStageId = resolveActiveStage()` (cached, refreshed ~5s).
2. If null → append a `0` sample, broadcast, return.
3. Read `processed_count:{activeStageId}` from Redis.
4. If `lastSample.stageId != activeStageId` → **re-baseline**: store the new
   (stageId, count, ts) and emit `0` (do not compute a cross-stage delta).
5. Else `unitsPerSec = (count - lastSample.count) / elapsedSeconds`. Clamp negatives to
   `0` (counter reset / claim-vs-publish races). Append to ring buffer, broadcast.
6. Update `lastSample`.

**Throughput source decision:** `processed_count` delta. Workers call
`increment_processed_count(stage_id, work_count)` in the main loop, so it is a genuine
units-processed counter. *Caveat (project memory):* if it proves sparse/gated in
practice, the drop-in fallback is `stage_work_index` (the atomic claim counter) — same
delta math, swap the key. Make the source key a single constant so the swap is trivial.

### In-memory ring buffer

Fixed-capacity circular buffer of `ThroughputSample {tsEpochMillis, stageId, unitsPerSec}`,
sized for a ~2h rolling window at 1s resolution (7200 entries). Thread-safe for one writer
(sampler) and many readers (REST history + WS broadcast) — copy-on-read snapshot or a
synchronized/`ArrayDeque` guarded structure.

### WebSocket

Spring WebSocket + STOMP. Broadcast topic `/topic/throughput`. Each 1s sample fans out to
**all** connected UI instances from the single shared buffer. STOMP gives clean pub/sub +
straightforward client reconnect. New clients fetch history first (REST), then receive
live deltas over the socket.

### REST endpoints (BFF)

- `GET /api/dashboard/campaigns` — proxy/transform mw campaigns (ACTIVE-first sort).
- `GET /api/dashboard/campaigns/{id}/progression` — proxy mw progression.
- `GET /api/dashboard/stages/{id}/live` — Redis-derived: processedCount, workIndex,
  totalPairs, progressPct, best-novel results.
- `GET /api/dashboard/throughput/history?window=<seconds>` — buffered u/s series for
  initial chart load.

### DTOs

`ThroughputSample {ts, stageId, unitsPerSec}`,
`LiveStageDto {stageId, processedCount, workIndex, totalPairs, progressPct, bestResults[]}`,
`CampaignDto`, `ProgressionPointDto` (mirror mw fields, camelCase).

## Frontend — `ramsey-ui-web`

React + TypeScript (Vite). **Recharts** for charts (React-native, pretty, handles the
live point counts easily). Auto-reconnecting STOMP client (`@stomp/stompjs`).

### Views (parity + new)

- Campaign selector (sidebar) — same ACTIVE-first sorting + RAMSEY_CAMPAIGN_ID-style
  default behavior as today.
- Live stat cards: active stage, current clique count (+Δ from start), total improvement,
  stage progress %, **current u/s**.
- **NEW — Realtime throughput graph:** work-units/sec over time, live via WebSocket.
- Clique-count-over-stages chart (historical, from progression).
- Improvement-per-stage bar chart (green = improvement, red = regression).
- Best-novel-results table (clique count, Δ vs current, edges-to-flip; handles the
  vertex-0 falsy bug and legacy full-graph results, as today).
- Collapsible raw-data table.

### The 1s / 5s / 30s control

Backend always streams at 1s base resolution. The control sets the **display bucket**,
purely client-side (never affects other instances):

- Client retains the raw 1s stream for the visible window.
- For bucket `B`, group samples into `B`-second buckets, plot **mean u/s per bucket**, and
  advance the chart every `B` seconds.
- `1s` = raw live; `30s` = smoothed (each point = avg over 30s, advances every 30s).

### WebSocket client

Subscribe to `/topic/throughput`; merge incoming samples into chart state with a bounded
client-side window. On disconnect, auto-reconnect and re-fetch history to fill any gap.

## Visual direction ("make it pretty")

Modern dark dashboard, applied via the frontend-design skill at build time:

- **Layout:** left sidebar (campaign selector + interval control + last-updated), main
  column with a row of compact stat cards on top, the live throughput graph as the hero
  panel, then the historical charts, then tables in cards.
- **Theme:** dark slate background, restrained accent palette — green for
  improvement/healthy throughput, red for regression, a cool accent (cyan/indigo) for the
  live line. Generous spacing, rounded cards, subtle borders, no chart gridline clutter.
- **Typography:** one clean sans (e.g. Inter); tabular-nums for all metrics so figures
  don't jitter as they update.
- **Motion:** the live graph updates smoothly without full-page reflow; stat cards
  animate value changes subtly.

(If mockups are wanted before/during the build, produce them then; not blocking.)

## Deployment (local edits only)

- New multi-stage Dockerfile in `ramsey-ui`: build stage (Maven + Node → fat jar),
  runtime stage (slim JRE 25 running the jar).
- Compose `ramsey-ui` service (`ramsey-mw/docker/main/ramsey-compose.yml` and the
  `m1-worker`/`dell-worker` variants): internal port `8080`, **external `36003` preserved**
  (`36003:8080`). Same env (`API_BASE_URL`, `REDIS_HOST`, `REDIS_PORT`), `ramsey-net`,
  Loki logging, `depends_on: ramsey-mw healthy`.
- **No Portainer push** without explicit confirmation.

## Testing strategy

- **Backend (JUnit + spring-boot-starter-test):** unit tests for the sampler (delta math,
  stage-transition re-baseline, negative-clamp, ring-buffer windowing/eviction);
  a WebSocket integration test (connect → receive a broadcast sample); a thin test for the
  Redis live-stage mapping (best-results parsing incl. vertex-0).
- **Frontend (Vitest + React Testing Library):** the bucketing/aggregation logic
  (1/5/30s), the socket-merge + windowing reducer, and the best-results edge formatting.
  Optional Playwright smoke test (page loads, socket connects, graph renders).

## Risks / open items

- **Throughput source reliability** — mitigated by the constant-key fallback to
  `stage_work_index` (see sampler note).
- **Java 25 / Spring Boot 4.1.0 toolchain** for a brand-new module — must match the mw/qm
  setup (Spring Boot 4.1.0, Jackson 3 `tools.jackson`, maven-compiler-plugin release 25);
  verify the frontend-maven-plugin + Node version build cleanly in Docker.
- **In-memory history loss on restart** — accepted; the counter is cumulative so u/s
  resumes immediately on the next tick.
