package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.model.LiveTick;
import com.setminusx.ramsey.ui.model.ThroughputSample;
import com.setminusx.ramsey.ui.redis.RedisLiveStageService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class ThroughputSamplerTest {

    static class MutableClock extends Clock {
        private Instant now;
        MutableClock(Instant start) { this.now = start; }
        void advanceMillis(long ms) { now = now.plusMillis(ms); }
        @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId z) { return this; }
        @Override public Instant instant() { return now; }
    }

    private final ActiveStageResolver resolver = mock(ActiveStageResolver.class);
    private final RedisLiveStageService redis = mock(RedisLiveStageService.class);
    private final ThroughputBroadcaster broadcaster = mock(ThroughputBroadcaster.class);
    private final ThroughputBuffer buffer = new ThroughputBuffer(100);
    private final MutableClock clock = new MutableClock(Instant.parse("2026-06-20T00:00:00Z"));
    private final ThroughputSampler sampler =
            new ThroughputSampler(resolver, redis, buffer, broadcaster, clock);

    private LiveTick lastBroadcast() {
        ArgumentCaptor<LiveTick> cap = ArgumentCaptor.forClass(LiveTick.class);
        verify(broadcaster, atLeastOnce()).broadcast(cap.capture());
        return cap.getValue();
    }

    private List<LiveTick> allBroadcasts() {
        ArgumentCaptor<LiveTick> cap = ArgumentCaptor.forClass(LiveTick.class);
        verify(broadcaster, atLeastOnce()).broadcast(cap.capture());
        return cap.getAllValues();
    }

    @Test
    void emits_empty_tick_when_no_active_stage() {
        when(resolver.resolveActiveStages()).thenReturn(List.of());
        sampler.sample();
        LiveTick t = lastBroadcast();
        assertThat(t.campaignId()).isNull();
        assertThat(t.stageId()).isNull();
        assertThat(t.unitsPerSec()).isZero();
        assertThat(t.progressPct()).isZero();
    }

    @Test
    void first_sample_baselines_then_computes_rate_and_progress() {
        when(resolver.resolveActiveStages()).thenReturn(List.of(new ActiveStage(2, 42, 775623L)));
        when(redis.getWorkIndex(42)).thenReturn(300L);
        when(redis.getTotalPairs(42)).thenReturn(600L);

        when(redis.getProcessedCount(42)).thenReturn(1000L);
        sampler.sample(); // baseline, expect 0/s

        clock.advanceMillis(1000);
        when(redis.getProcessedCount(42)).thenReturn(1100L);
        sampler.sample(); // +100 over 1s => 100/s

        assertThat(buffer.snapshot()).extracting(ThroughputSample::unitsPerSec)
                .containsExactly(0.0, 100.0);
        LiveTick t = lastBroadcast();
        assertThat(t.campaignId()).isEqualTo(2);
        assertThat(t.stageId()).isEqualTo(42);
        assertThat(t.unitsPerSec()).isEqualTo(100.0);
        assertThat(t.progressPct()).isEqualTo(50.0);
        assertThat(t.cliqueCount()).isEqualTo(775623L);
    }

    @Test
    void samples_each_active_campaign_with_independent_baselines() {
        // the multi-campaign case: local fleet on campaign 12, remote fleet on campaign 10 —
        // each gets its own tick with its own rate, computed from its own baseline.
        when(resolver.resolveActiveStages()).thenReturn(List.of(
                new ActiveStage(10, 100, 26031L), new ActiveStage(12, 200, 27668L)));
        when(redis.getProcessedCount(100)).thenReturn(1_000L);
        when(redis.getProcessedCount(200)).thenReturn(50_000L);
        sampler.sample(); // baseline both

        clock.advanceMillis(1000);
        when(redis.getProcessedCount(100)).thenReturn(1_250L);   // +250/s (remote)
        when(redis.getProcessedCount(200)).thenReturn(650_000L); // +600K/s (local)
        sampler.sample();

        assertThat(buffer.snapshot()).extracting(ThroughputSample::campaignId, ThroughputSample::unitsPerSec)
                .containsExactly(
                        tuple(10, 0.0), tuple(12, 0.0),
                        tuple(10, 250.0), tuple(12, 600_000.0));
        List<LiveTick> ticks = allBroadcasts();
        assertThat(ticks).hasSize(4);
        assertThat(ticks.get(2).campaignId()).isEqualTo(10);
        assertThat(ticks.get(2).unitsPerSec()).isEqualTo(250.0);
        assertThat(ticks.get(3).campaignId()).isEqualTo(12);
        assertThat(ticks.get(3).unitsPerSec()).isEqualTo(600_000.0);
    }

    @Test
    void drops_baseline_when_campaign_goes_inactive_and_rebaselines_on_return() {
        when(resolver.resolveActiveStages()).thenReturn(List.of(new ActiveStage(11, 42, 1L)));
        when(redis.getProcessedCount(42)).thenReturn(1000L);
        sampler.sample(); // baseline campaign 11

        clock.advanceMillis(1000);
        when(resolver.resolveActiveStages()).thenReturn(List.of(new ActiveStage(12, 50, 2L)));
        when(redis.getProcessedCount(50)).thenReturn(10L);
        sampler.sample(); // campaign 11 banked; 12 baselines at 0

        clock.advanceMillis(1000);
        when(resolver.resolveActiveStages()).thenReturn(List.of(new ActiveStage(11, 42, 1L)));
        when(redis.getProcessedCount(42)).thenReturn(9_999_999L);
        sampler.sample(); // 11 returns: stale baseline must be gone -> 0, not a huge spike

        assertThat(buffer.snapshot()).extracting(ThroughputSample::unitsPerSec)
                .containsExactly(0.0, 0.0, 0.0);
    }

    @Test
    void one_campaigns_redis_failure_does_not_starve_the_other() {
        when(resolver.resolveActiveStages()).thenReturn(List.of(
                new ActiveStage(10, 100, 1L), new ActiveStage(12, 200, 2L)));
        when(redis.getProcessedCount(100)).thenThrow(new RuntimeException("redis down"));
        when(redis.getProcessedCount(200)).thenReturn(500L);

        sampler.sample(); // must not throw; campaign 12 still emits

        assertThat(buffer.snapshot()).extracting(ThroughputSample::campaignId)
                .containsExactly(12);
    }

    @Test
    void clamps_negative_rate_on_counter_reset() {
        when(resolver.resolveActiveStages()).thenReturn(List.of(new ActiveStage(2, 42, 1L)));
        when(redis.getProcessedCount(42)).thenReturn(5000L);
        sampler.sample();
        clock.advanceMillis(1000);
        when(redis.getProcessedCount(42)).thenReturn(10L); // reset
        sampler.sample();
        assertThat(buffer.snapshot()).extracting(ThroughputSample::unitsPerSec)
                .containsExactly(0.0, 0.0);
    }

    @Test
    void rebaselines_without_spike_on_stage_change() {
        when(resolver.resolveActiveStages()).thenReturn(List.of(new ActiveStage(2, 42, 1L)));
        when(redis.getProcessedCount(42)).thenReturn(1000L);
        sampler.sample(); // baseline stage 42

        clock.advanceMillis(1000);
        when(resolver.resolveActiveStages()).thenReturn(List.of(new ActiveStage(2, 43, 1L))); // new stage
        when(redis.getProcessedCount(43)).thenReturn(50L);
        sampler.sample(); // re-baseline, expect 0 (no negative spike 1000->50)

        assertThat(buffer.snapshot()).extracting(ThroughputSample::unitsPerSec)
                .containsExactly(0.0, 0.0);
        assertThat(buffer.snapshot().get(1).stageId()).isEqualTo(43);
    }

    @Test
    void skips_tick_without_emitting_when_redis_read_fails() {
        when(resolver.resolveActiveStages()).thenReturn(List.of(new ActiveStage(2, 42, 1L)));
        when(redis.getProcessedCount(42)).thenThrow(new RuntimeException("redis down"));
        sampler.sample(); // must not throw
        assertThat(buffer.snapshot()).isEmpty();
        verifyNoInteractions(broadcaster);
    }

    private static org.assertj.core.groups.Tuple tuple(Object... values) {
        return org.assertj.core.groups.Tuple.tuple(values);
    }

    // ---------- campaign-scoped counter (survives stage advances) ----------

    /**
     * The regression this counter exists for: near the floor a stage advances faster than the
     * sampler ticks, and the per-stage counter is deleted on advance. Differencing it forced a
     * 0.0 reading on every turnover, so fleet throughput read an order of magnitude low.
     */
    @Test
    void throughput_survives_a_stage_advance() {
        when(resolver.resolveActiveStages()).thenReturn(List.of(new ActiveStage(2, 42, 775623L)));
        when(redis.getProcessedTotal(2)).thenReturn(1_000_000L);
        sampler.sample(); // baseline

        // Stage advanced: new stage id, and its per-stage counter restarted from near zero.
        clock.advanceMillis(1000);
        when(resolver.resolveActiveStages()).thenReturn(List.of(new ActiveStage(2, 43, 775000L)));
        when(redis.getProcessedTotal(2)).thenReturn(1_500_000L);
        sampler.sample();

        assertThat(buffer.snapshot()).extracting(ThroughputSample::unitsPerSec)
                .containsExactly(0.0, 500_000.0);
    }

    /** Without the campaign total (older workers) the per-stage behaviour still applies. */
    @Test
    void fallsBackToPerStageCounterWhenCampaignTotalAbsent() {
        when(resolver.resolveActiveStages()).thenReturn(List.of(new ActiveStage(2, 42, 775623L)));
        when(redis.getProcessedTotal(2)).thenReturn(0L);
        when(redis.getProcessedCount(42)).thenReturn(1000L);
        sampler.sample();

        clock.advanceMillis(1000);
        when(redis.getProcessedCount(42)).thenReturn(1400L);
        sampler.sample();

        assertThat(buffer.snapshot()).extracting(ThroughputSample::unitsPerSec)
                .containsExactly(0.0, 400.0);
    }

    /** A counter that goes backwards (Redis flush) must re-baseline, not emit a negative spike. */
    @Test
    void counterGoingBackwardsDoesNotProduceASpike() {
        when(resolver.resolveActiveStages()).thenReturn(List.of(new ActiveStage(2, 42, 775623L)));
        when(redis.getProcessedTotal(2)).thenReturn(5_000_000L);
        sampler.sample();

        clock.advanceMillis(1000);
        when(redis.getProcessedTotal(2)).thenReturn(120L); // wiped and restarted
        sampler.sample();

        assertThat(buffer.snapshot()).extracting(ThroughputSample::unitsPerSec)
                .containsExactly(0.0, 0.0);
    }
}
