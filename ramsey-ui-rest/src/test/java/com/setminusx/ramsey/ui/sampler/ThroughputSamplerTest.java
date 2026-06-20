package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.model.ThroughputSample;
import com.setminusx.ramsey.ui.redis.StageCounterReader;
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

    private ThroughputSample lastBroadcast(ThroughputBroadcaster b) {
        ArgumentCaptor<ThroughputSample> cap = ArgumentCaptor.forClass(ThroughputSample.class);
        verify(b, atLeastOnce()).broadcast(cap.capture());
        return cap.getValue();
    }

    @Test
    void emits_zero_when_no_active_stage() {
        ActiveStageResolver resolver = mock(ActiveStageResolver.class);
        StageCounterReader reader = mock(StageCounterReader.class);
        ThroughputBroadcaster broadcaster = mock(ThroughputBroadcaster.class);
        ThroughputBuffer buffer = new ThroughputBuffer(100);
        when(resolver.resolveActiveStageId()).thenReturn(null);

        ThroughputSampler sampler = new ThroughputSampler(resolver, reader, buffer, broadcaster,
                new MutableClock(Instant.parse("2026-06-20T00:00:00Z")));
        sampler.sample();

        assertThat(lastBroadcast(broadcaster).unitsPerSec()).isZero();
        assertThat(lastBroadcast(broadcaster).stageId()).isNull();
    }

    @Test
    void first_sample_baselines_at_zero_then_computes_rate() {
        ActiveStageResolver resolver = mock(ActiveStageResolver.class);
        StageCounterReader reader = mock(StageCounterReader.class);
        ThroughputBroadcaster broadcaster = mock(ThroughputBroadcaster.class);
        ThroughputBuffer buffer = new ThroughputBuffer(100);
        MutableClock clock = new MutableClock(Instant.parse("2026-06-20T00:00:00Z"));
        when(resolver.resolveActiveStageId()).thenReturn(42);

        ThroughputSampler sampler = new ThroughputSampler(resolver, reader, buffer, broadcaster, clock);

        when(reader.readProcessedCount(42)).thenReturn(1000L);
        sampler.sample(); // baseline, expect 0

        clock.advanceMillis(1000);
        when(reader.readProcessedCount(42)).thenReturn(1100L);
        sampler.sample(); // +100 over 1s => 100/s

        assertThat(buffer.snapshot()).extracting(ThroughputSample::unitsPerSec)
                .containsExactly(0.0, 100.0);
    }

    @Test
    void clamps_negative_rate_on_counter_reset() {
        ActiveStageResolver resolver = mock(ActiveStageResolver.class);
        StageCounterReader reader = mock(StageCounterReader.class);
        ThroughputBroadcaster broadcaster = mock(ThroughputBroadcaster.class);
        ThroughputBuffer buffer = new ThroughputBuffer(100);
        MutableClock clock = new MutableClock(Instant.parse("2026-06-20T00:00:00Z"));
        when(resolver.resolveActiveStageId()).thenReturn(42);

        ThroughputSampler sampler = new ThroughputSampler(resolver, reader, buffer, broadcaster, clock);
        when(reader.readProcessedCount(42)).thenReturn(5000L);
        sampler.sample();
        clock.advanceMillis(1000);
        when(reader.readProcessedCount(42)).thenReturn(10L); // reset
        sampler.sample();

        assertThat(buffer.snapshot()).extracting(ThroughputSample::unitsPerSec)
                .containsExactly(0.0, 0.0);
    }

    @Test
    void rebaselines_without_spike_on_stage_change() {
        ActiveStageResolver resolver = mock(ActiveStageResolver.class);
        StageCounterReader reader = mock(StageCounterReader.class);
        ThroughputBroadcaster broadcaster = mock(ThroughputBroadcaster.class);
        ThroughputBuffer buffer = new ThroughputBuffer(100);
        MutableClock clock = new MutableClock(Instant.parse("2026-06-20T00:00:00Z"));

        ThroughputSampler sampler = new ThroughputSampler(resolver, reader, buffer, broadcaster, clock);

        when(resolver.resolveActiveStageId()).thenReturn(42);
        when(reader.readProcessedCount(42)).thenReturn(1000L);
        sampler.sample(); // baseline stage 42

        clock.advanceMillis(1000);
        when(resolver.resolveActiveStageId()).thenReturn(43); // new stage
        when(reader.readProcessedCount(43)).thenReturn(50L);
        sampler.sample(); // re-baseline, expect 0 (no negative spike from 1000->50)

        assertThat(buffer.snapshot()).extracting(ThroughputSample::unitsPerSec)
                .containsExactly(0.0, 0.0);
        assertThat(buffer.snapshot().get(1).stageId()).isEqualTo(43);
    }
}
