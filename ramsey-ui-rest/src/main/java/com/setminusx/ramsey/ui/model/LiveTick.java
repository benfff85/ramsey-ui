package com.setminusx.ramsey.ui.model;

/**
 * One per-second broadcast per ACTIVE campaign: the throughput sample plus the stat-card values the
 * dashboard shows (stage, clique count). campaignId is null only on the idle heartbeat tick emitted
 * when no campaign is active.
 *
 * Deliberately small: it goes to every open dashboard once a second per campaign. The per-stage
 * progress fields were dropped on 2026-10-08. At several stages a second a stage's % is noise, and
 * computing it read the stage's ~40 KB config from Redis on every tick.
 */
public record LiveTick(long ts, Integer campaignId, Integer stageId, double unitsPerSec, Long cliqueCount) {}
