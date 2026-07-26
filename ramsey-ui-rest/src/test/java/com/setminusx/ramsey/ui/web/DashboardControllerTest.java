package com.setminusx.ramsey.ui.web;

import com.setminusx.ramsey.ui.client.MwClient;
import com.setminusx.ramsey.ui.service.ProgressionCache;
import com.setminusx.ramsey.ui.config.RamseyProperties;
import com.setminusx.ramsey.ui.model.*;
import com.setminusx.ramsey.ui.redis.RedisLiveStageService;
import com.setminusx.ramsey.ui.sampler.ThroughputBuffer;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class DashboardControllerTest {

    private final MwClient mw = mock(MwClient.class);
    private final RedisLiveStageService live = mock(RedisLiveStageService.class);
    private final ThroughputBuffer buffer = new ThroughputBuffer(100);
    private final RamseyProperties props = new RamseyProperties("http://mw:8080",
            new RamseyProperties.Sampler(1000), new RamseyProperties.Throughput(100, 7200));
    private final Clock clock = Clock.fixed(Instant.ofEpochMilli(2000), ZoneOffset.UTC);
    private final ProgressionCache progressionCache = new ProgressionCache(mw);
    private final DashboardController controller =
            new DashboardController(mw, live, buffer, props, clock, progressionCache);

    @Test
    void campaigns_delegates_to_mw() {
        CampaignDto c = new CampaignDto(10, 8, 281, 600L, "S", "ACTIVE", "x", "y");
        when(mw.getCampaigns()).thenReturn(List.of(c));
        assertThat(controller.campaigns()).containsExactly(c);
    }

    @Test
    void progression_delegates_to_mw() {
        ProgressionPointDto p = new ProgressionPointDto(42, 1, 775623L, "ACTIVE", "x", null, null);
        when(mw.getProgression(10)).thenReturn(List.of(p));
        assertThat(controller.progression(10, null, null))
                .extracting(ProgressionPointDto::stageId).containsExactly(42);
    }

    /** The dashboard holds the history and polls only for the tail. */
    @Test
    void progression_sinceStageId_returnsOnlyNewerPoints() {
        ProgressionPointDto older = new ProgressionPointDto(42, 1, 775623L, "INACTIVE", "x", null, null);
        ProgressionPointDto newer = new ProgressionPointDto(43, 2, 775000L, "ACTIVE", "y", null, null);
        when(mw.getProgression(10)).thenReturn(List.of(older, newer));
        assertThat(controller.progression(10, 42, null))
                .extracting(ProgressionPointDto::stageId).containsExactly(43);
        assertThat(controller.progression(10, 43, null)).isEmpty();
    }

    /** Repeated polls during a fast descent must not re-query the middleware every time. */
    @Test
    void progression_isCachedAcrossCalls() {
        ProgressionPointDto p = new ProgressionPointDto(42, 1, 775623L, "ACTIVE", "x", null, null);
        when(mw.getProgression(10)).thenReturn(List.of(p));
        for (int i = 0; i < 20; i++) {
            controller.progression(10, 41, null);
        }
        verify(mw, times(1)).getProgression(10);
    }

    @Test
    void live_delegates_to_redis_service() {
        LiveStageDto dto = new LiveStageDto(42, 1500, 300, 600, 50.0, List.of());
        when(live.getLiveStage(42)).thenReturn(dto);
        assertThat(controller.live(42)).isEqualTo(dto);
    }

    @Test
    void history_filters_by_window() {
        buffer.add(new ThroughputSample(1000, 10, 42, 0.0));
        buffer.add(new ThroughputSample(2000, 12, 43, 123.0));
        // clock=2000ms; window=2s => since=0 => both points
        assertThat(controller.history(2, null)).hasSize(2);
        // window=0 => since=2000 => only ts>=2000 => one point
        assertThat(controller.history(0, null)).hasSize(1);
        // null window => default (7200s) => since well before 1000 => all points
        assertThat(controller.history(null, null)).hasSize(2);
    }

    @Test
    void history_filters_by_campaign() {
        buffer.add(new ThroughputSample(1000, 10, 42, 5.0));
        buffer.add(new ThroughputSample(1000, 12, 43, 7.0));
        buffer.add(new ThroughputSample(2000, 12, 43, 9.0));
        assertThat(controller.history(null, 12)).extracting(ThroughputSample::unitsPerSec)
                .containsExactly(7.0, 9.0);
        assertThat(controller.history(null, 10)).hasSize(1);
        assertThat(controller.history(null, null)).hasSize(3);
    }

    // ---------- downsampling for clients that cannot take the whole series ----------

    private ProgressionPointDto pt(int stageId, long clique, String details) {
        return new ProgressionPointDto(stageId, stageId, clique, "INACTIVE", "t", details, null);
    }

    /**
     * A plain stride would be wrong: the chart derives its epochs from kick markers and its legend
     * floors from each epoch's minimum, so those points must survive sampling or the dashboard
     * reports different numbers, not just a coarser line.
     */
    @Test
    void sampling_keepsKickMarkersAndEpochFloors() {
        List<ProgressionPointDto> series = new java.util.ArrayList<>();
        for (int i = 1; i <= 400; i++) {
            String details = (i == 100 || i == 250) ? "PERTURBATION kick from graph 1 (5)" : null;
            long clique = 900_000L - i;          // gently descending
            if (i == 60) clique = 1L;            // epoch-0 floor
            if (i == 180) clique = 2L;           // epoch-1 floor
            if (i == 300) clique = 3L;           // epoch-2 floor
            series.add(pt(i, clique, details));
        }
        when(mw.getProgression(7)).thenReturn(series);

        List<ProgressionPointDto> out = controller.progression(7, null, 50);

        assertThat(out).hasSizeLessThanOrEqualTo(50);
        assertThat(out).extracting(ProgressionPointDto::stageId)
                .contains(100, 250)             // both kicks
                .contains(60, 180, 300)         // all three epoch floors
                .contains(1, 400);              // endpoints
    }

    /** idx is assigned before sampling, so the chart's x-axis still reads in real stages. */
    @Test
    void sampling_preservesTrueSeriesPosition() {
        List<ProgressionPointDto> series = new java.util.ArrayList<>();
        for (int i = 0; i < 300; i++) series.add(pt(i + 1, 500L + i, null));
        when(mw.getProgression(7)).thenReturn(series);

        List<ProgressionPointDto> out = controller.progression(7, null, 30);

        assertThat(out).hasSizeLessThanOrEqualTo(30);
        // Every surviving point's idx equals its position in the FULL series (stageId - 1 here).
        assertThat(out).allSatisfy(p -> assertThat(p.idx()).isEqualTo(p.stageId() - 1));
        assertThat(out.get(out.size() - 1).idx()).isEqualTo(299);
    }

    /** A series already under the cap must come back untouched. */
    @Test
    void sampling_isANoOpBelowTheCap() {
        List<ProgressionPointDto> series = List.of(pt(1, 10L, null), pt(2, 9L, null));
        when(mw.getProgression(7)).thenReturn(series);
        assertThat(controller.progression(7, null, 500))
                .extracting(ProgressionPointDto::stageId).containsExactly(1, 2);
    }
}
