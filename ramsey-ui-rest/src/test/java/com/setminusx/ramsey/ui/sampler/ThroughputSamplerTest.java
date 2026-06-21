package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.model.LiveTick;
import com.setminusx.ramsey.ui.model.ThroughputSample;
import com.setminusx.ramsey.ui.redis.RedisLiveStageService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

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

    @Test
    void emits_empty_tick_when_no_active_stage() {
        when(resolver.resolveActiveStage()).thenReturn(null);
        sampler.sample();
        LiveTick t = lastBroadcast();
        assertThat(t.stageId()).isNull();
        assertThat(t.unitsPerSec()).isZero();
        assertThat(t.progressPct()).isZero();
    }

    @Test
    void first_sample_baselines_then_computes_rate_and_progress() {
        when(resolver.resolveActiveStage()).thenReturn(new ActiveStage(42, 775623L));
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
        assertThat(t.stageId()).isEqualTo(42);
        assertThat(t.unitsPerSec()).isEqualTo(100.0);
        assertThat(t.progressPct()).isEqualTo(50.0);
        assertThat(t.cliqueCount()).isEqualTo(775623L);
    }

    @Test
    void clamps_negative_rate_on_counter_reset() {
        when(resolver.resolveActiveStage()).thenReturn(new ActiveStage(42, 1L));
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
        when(resolver.resolveActiveStage()).thenReturn(new ActiveStage(42, 1L));
        when(redis.getProcessedCount(42)).thenReturn(1000L);
        sampler.sample(); // baseline stage 42

        clock.advanceMillis(1000);
        when(resolver.resolveActiveStage()).thenReturn(new ActiveStage(43, 1L)); // new stage
        when(redis.getProcessedCount(43)).thenReturn(50L);
        sampler.sample(); // re-baseline, expect 0 (no negative spike 1000->50)

        assertThat(buffer.snapshot()).extracting(ThroughputSample::unitsPerSec)
                .containsExactly(0.0, 0.0);
        assertThat(buffer.snapshot().get(1).stageId()).isEqualTo(43);
    }

    @Test
    void skips_tick_without_emitting_when_redis_read_fails() {
        when(resolver.resolveActiveStage()).thenReturn(new ActiveStage(42, 1L));
        when(redis.getProcessedCount(42)).thenThrow(new RuntimeException("redis down"));
        sampler.sample(); // must not throw
        assertThat(buffer.snapshot()).isEmpty();
        verifyNoInteractions(broadcaster);
    }
}
