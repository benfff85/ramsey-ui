package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.client.MwClient;
import com.setminusx.ramsey.ui.model.CampaignDto;
import com.setminusx.ramsey.ui.model.ProgressionPointDto;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class ActiveStageResolverTest {

    private CampaignDto campaign(int id, String status) {
        return new CampaignDto(id, 8, 281, 600L, "S", status, "2026-06-14T10:00:00", "2026-06-16T12:00:00");
    }
    private ProgressionPointDto stage(int id, String status) {
        return new ProgressionPointDto(id, 1, 100L, status, "2026-06-16T12:00:00");
    }

    @Test
    void resolves_active_stage_of_active_campaign() {
        MwClient mw = mock(MwClient.class);
        when(mw.getCampaigns()).thenReturn(List.of(campaign(1, "INACTIVE"), campaign(10, "ACTIVE")));
        when(mw.getProgression(10)).thenReturn(List.of(stage(40, "COMPLETE"), stage(42, "ACTIVE")));

        ActiveStageResolver resolver = new ActiveStageResolver(mw, Clock.systemUTC());
        assertThat(resolver.resolveActiveStageId()).isEqualTo(42);
    }

    @Test
    void returns_null_when_no_active_campaign() {
        MwClient mw = mock(MwClient.class);
        when(mw.getCampaigns()).thenReturn(List.of(campaign(1, "INACTIVE")));
        ActiveStageResolver resolver = new ActiveStageResolver(mw, Clock.systemUTC());
        assertThat(resolver.resolveActiveStageId()).isNull();
    }

    @Test
    void returns_null_when_mw_unreachable() {
        MwClient mw = mock(MwClient.class);
        when(mw.getCampaigns()).thenThrow(new RuntimeException("connection refused"));
        ActiveStageResolver resolver = new ActiveStageResolver(mw, Clock.systemUTC());
        assertThat(resolver.resolveActiveStageId()).isNull();
    }

    @Test
    void caches_within_window_then_refreshes() {
        MwClient mw = mock(MwClient.class);
        when(mw.getCampaigns()).thenReturn(List.of(campaign(10, "ACTIVE")));
        when(mw.getProgression(10)).thenReturn(List.of(stage(42, "ACTIVE")));

        MutableClock clock = new MutableClock(Instant.parse("2026-06-20T00:00:00Z"));
        ActiveStageResolver resolver = new ActiveStageResolver(mw, clock);

        resolver.resolveActiveStageId();
        resolver.resolveActiveStageId();
        verify(mw, times(1)).getCampaigns(); // cached, only one call

        clock.advanceSeconds(6);
        resolver.resolveActiveStageId();
        verify(mw, times(2)).getCampaigns(); // cache expired, refreshed
    }

    // Minimal adjustable clock for cache tests.
    static class MutableClock extends Clock {
        private Instant now;
        MutableClock(Instant start) { this.now = start; }
        void advanceSeconds(long s) { now = now.plusSeconds(s); }
        @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId z) { return this; }
        @Override public Instant instant() { return now; }
    }
}
