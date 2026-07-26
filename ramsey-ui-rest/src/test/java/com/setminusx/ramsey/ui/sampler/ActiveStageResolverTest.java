package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.client.MwClient;
import com.setminusx.ramsey.ui.model.CampaignDto;
import com.setminusx.ramsey.ui.model.StageDto;
import com.setminusx.ramsey.ui.model.GraphDto;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.*;

class ActiveStageResolverTest {

    private CampaignDto campaign(int id, String status) {
        return new CampaignDto(id, 8, 281, 600L, "S", status, "2026-06-14T10:00:00", "2026-06-16T12:00:00");
    }

    @Test
    void resolves_active_stage_with_clique_count_and_campaign_id() {
        MwClient mw = mock(MwClient.class);
        when(mw.getCampaigns()).thenReturn(List.of(campaign(1, "INACTIVE"), campaign(10, "ACTIVE")));
        when(mw.getActiveStages(10)).thenReturn(List.of(new StageDto(42, 10, 4200, "ACTIVE")));
        when(mw.getGraph(4200)).thenReturn(new GraphDto(4200, 775623, 282));

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
        when(mw.getActiveStages(10)).thenReturn(List.of(new StageDto(16023, 10, 5001, "ACTIVE")));
        when(mw.getGraph(5001)).thenReturn(new GraphDto(5001, 26031, 282));
        when(mw.getActiveStages(12)).thenReturn(List.of(new StageDto(16022, 12, 5002, "ACTIVE")));
        when(mw.getGraph(5002)).thenReturn(new GraphDto(5002, 27668, 282));

        List<ActiveStage> actives = new ActiveStageResolver(mw, Clock.systemUTC()).resolveActiveStages();
        assertThat(actives).containsExactly(
                new ActiveStage(10, 16023, 26031L),
                new ActiveStage(12, 16022, 27668L));
        verify(mw, never()).getActiveStages(11);
    }

    @Test
    void omits_active_campaign_that_has_no_active_stage() {
        MwClient mw = mock(MwClient.class);
        when(mw.getCampaigns()).thenReturn(List.of(campaign(10, "ACTIVE"), campaign(12, "ACTIVE")));
        when(mw.getActiveStages(10)).thenReturn(List.of()); // campaign is ACTIVE but has no ACTIVE stage
        when(mw.getActiveStages(12)).thenReturn(List.of(new StageDto(50, 12, 5050, "ACTIVE")));
        when(mw.getGraph(5050)).thenReturn(new GraphDto(5050, 27668, 282));

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
        when(mw.getActiveStages(10)).thenReturn(List.of(new StageDto(42, 10, 4200, "ACTIVE")));
        when(mw.getGraph(4200)).thenReturn(new GraphDto(4200, 775623, 282));

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

    /**
     * The resolver must NOT read a campaign's progression. That series is the whole history —
     * 21 MB and 143,000 points and growing — and scanning it for one stage id used to cost that
     * on every refresh, for a few hundred bytes of answer.
     */
    @Test
    void never_reads_the_progression() {
        MwClient mw = mock(MwClient.class);
        when(mw.getCampaigns()).thenReturn(List.of(campaign(10, "ACTIVE")));
        when(mw.getActiveStages(10)).thenReturn(List.of(new StageDto(42, 10, 4200, "ACTIVE")));
        when(mw.getGraph(4200)).thenReturn(new GraphDto(4200, 775623, 282));

        new ActiveStageResolver(mw, Clock.systemUTC()).resolveActiveStages();

        verify(mw, never()).getProgression(anyInt());
    }
}
