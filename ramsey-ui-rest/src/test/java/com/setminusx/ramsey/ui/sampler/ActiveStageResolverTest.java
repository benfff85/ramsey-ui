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
    private ProgressionPointDto stage(int id, long clique, String status) {
        return new ProgressionPointDto(id, 1, clique, status, "2026-06-16T12:00:00", null, null);
    }

    @Test
    void resolves_active_stage_with_clique_count_and_campaign_id() {
        MwClient mw = mock(MwClient.class);
        when(mw.getCampaigns()).thenReturn(List.of(campaign(1, "INACTIVE"), campaign(10, "ACTIVE")));
        when(mw.getProgression(10)).thenReturn(List.of(stage(40, 999L, "COMPLETE"), stage(42, 775623L, "ACTIVE")));

        List<ActiveStage> actives = new ActiveStageResolver(mw, Clock.systemUTC()).resolveActiveStages();
        assertThat(actives).containsExactly(new ActiveStage(10, 42, 775623L));
    }

    @Test
    void resolves_one_active_stage_per_active_campaign() {
        // The system runs multiple ACTIVE campaigns concurrently (e.g. the remote-fleet
        // campaign 10 plus the local multi-seed campaign 12) — every one must be resolved,
        // not just the first the middleware happens to list.
        MwClient mw = mock(MwClient.class);
        when(mw.getCampaigns()).thenReturn(List.of(
                campaign(10, "ACTIVE"), campaign(11, "INACTIVE"), campaign(12, "ACTIVE")));
        when(mw.getProgression(10)).thenReturn(List.of(stage(16023, 26031L, "ACTIVE")));
        when(mw.getProgression(12)).thenReturn(List.of(stage(16022, 27668L, "ACTIVE")));

        List<ActiveStage> actives = new ActiveStageResolver(mw, Clock.systemUTC()).resolveActiveStages();
        assertThat(actives).containsExactly(
                new ActiveStage(10, 16023, 26031L),
                new ActiveStage(12, 16022, 27668L));
        verify(mw, never()).getProgression(11);
    }

    @Test
    void omits_active_campaign_that_has_no_active_stage() {
        MwClient mw = mock(MwClient.class);
        when(mw.getCampaigns()).thenReturn(List.of(campaign(10, "ACTIVE"), campaign(12, "ACTIVE")));
        when(mw.getProgression(10)).thenReturn(List.of(stage(40, 999L, "COMPLETE")));
        when(mw.getProgression(12)).thenReturn(List.of(stage(50, 27668L, "ACTIVE")));

        assertThat(new ActiveStageResolver(mw, Clock.systemUTC()).resolveActiveStages())
                .containsExactly(new ActiveStage(12, 50, 27668L));
    }

    @Test
    void returns_empty_when_no_active_campaign() {
        MwClient mw = mock(MwClient.class);
        when(mw.getCampaigns()).thenReturn(List.of(campaign(1, "INACTIVE")));
        assertThat(new ActiveStageResolver(mw, Clock.systemUTC()).resolveActiveStages()).isEmpty();
    }

    @Test
    void returns_empty_when_mw_unreachable() {
        MwClient mw = mock(MwClient.class);
        when(mw.getCampaigns()).thenThrow(new RuntimeException("connection refused"));
        assertThat(new ActiveStageResolver(mw, Clock.systemUTC()).resolveActiveStages()).isEmpty();
    }

    @Test
    void caches_within_window_then_refreshes() {
        MwClient mw = mock(MwClient.class);
        when(mw.getCampaigns()).thenReturn(List.of(campaign(10, "ACTIVE")));
        when(mw.getProgression(10)).thenReturn(List.of(stage(42, 775623L, "ACTIVE")));

        MutableClock clock = new MutableClock(Instant.parse("2026-06-20T00:00:00Z"));
        ActiveStageResolver resolver = new ActiveStageResolver(mw, clock);

        resolver.resolveActiveStages();
        resolver.resolveActiveStages();
        verify(mw, times(1)).getCampaigns(); // cached, only one call

        clock.advanceSeconds(6);
        resolver.resolveActiveStages();
        verify(mw, times(2)).getCampaigns(); // cache expired, refreshed
    }

    static class MutableClock extends Clock {
        private Instant now;
        MutableClock(Instant start) { this.now = start; }
        void advanceSeconds(long s) { now = now.plusSeconds(s); }
        @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId z) { return this; }
        @Override public Instant instant() { return now; }
    }
}
