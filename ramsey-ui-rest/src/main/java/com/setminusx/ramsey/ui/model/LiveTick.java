package com.setminusx.ramsey.ui.model;

/**
 * One per-second broadcast per ACTIVE campaign, carrying both the throughput sample and the
 * live stage stats, so the UI can drive the stat cards (stage, clique count, progress) straight
 * off the socket and follow stage transitions without a stale REST poll. campaignId is null only
 * on the idle heartbeat tick emitted when no campaign is active.
 */
public record LiveTick(long ts, Integer campaignId, Integer stageId, double unitsPerSec,
                       long processedCount, long workIndex, long totalPairs,
                       double progressPct, Long cliqueCount) {}
