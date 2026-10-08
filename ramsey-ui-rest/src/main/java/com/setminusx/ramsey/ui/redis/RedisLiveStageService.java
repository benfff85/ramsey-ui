package com.setminusx.ramsey.ui.redis;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/**
 * Reads the live Redis counters the throughput sampler needs. Per-stage progress, the work index
 * and the best-results set are no longer read (2026-10-08): the dashboard stopped showing them,
 * because at several stages a second they are noise.
 */
@Service
public class RedisLiveStageService {

    private final StringRedisTemplate redis;

    public RedisLiveStageService(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /** Units processed for one stage. Only the legacy fallback for workers without a campaign total. */
    public long getProcessedCount(int stageId) {
        return parseLong(redis.opsForValue().get(StageKeys.PROCESSED_COUNT + stageId));
    }

    /** Campaign-scoped running total of units processed; never reset by a stage advance. */
    public long getProcessedTotal(int campaignId) {
        return parseLong(redis.opsForValue().get(StageKeys.PROCESSED_TOTAL + campaignId));
    }

    private static long parseLong(String s) {
        if (s == null || s.isBlank()) return 0L;
        try { return Long.parseLong(s.trim()); } catch (NumberFormatException e) { return 0L; }
    }
}
