package com.setminusx.ramsey.ui.web;

import com.setminusx.ramsey.ui.client.MwClient;
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
    private final DashboardController controller = new DashboardController(mw, live, buffer, props, clock);

    @Test
    void campaigns_delegates_to_mw() {
        CampaignDto c = new CampaignDto(10, 8, 281, 600L, "S", "ACTIVE", "x", "y");
        when(mw.getCampaigns()).thenReturn(List.of(c));
        assertThat(controller.campaigns()).containsExactly(c);
    }

    @Test
    void progression_delegates_to_mw() {
        ProgressionPointDto p = new ProgressionPointDto(42, 1, 775623L, "ACTIVE", "x");
        when(mw.getProgression(10)).thenReturn(List.of(p));
        assertThat(controller.progression(10)).containsExactly(p);
    }

    @Test
    void live_delegates_to_redis_service() {
        LiveStageDto dto = new LiveStageDto(42, 1500, 300, 600, 50.0, List.of());
        when(live.getLiveStage(42)).thenReturn(dto);
        assertThat(controller.live(42)).isEqualTo(dto);
    }

    @Test
    void history_filters_by_window() {
        buffer.add(new ThroughputSample(1000, 42, 0.0));
        buffer.add(new ThroughputSample(2000, 42, 123.0));
        // clock=2000ms; window=2s => since=0 => both points
        assertThat(controller.history(2)).hasSize(2);
        // window=0 => since=2000 => only ts>=2000 => one point
        assertThat(controller.history(0)).hasSize(1);
        // null window => default (7200s) => since well before 1000 => all points
        assertThat(controller.history(null)).hasSize(2);
    }
}
