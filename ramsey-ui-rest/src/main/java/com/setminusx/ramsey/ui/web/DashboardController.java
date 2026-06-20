package com.setminusx.ramsey.ui.web;

import com.setminusx.ramsey.ui.client.MwClient;
import com.setminusx.ramsey.ui.config.RamseyProperties;
import com.setminusx.ramsey.ui.model.*;
import com.setminusx.ramsey.ui.redis.RedisLiveStageService;
import com.setminusx.ramsey.ui.sampler.ThroughputBuffer;
import org.springframework.web.bind.annotation.*;

import java.time.Clock;
import java.util.List;

@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {

    private final MwClient mwClient;
    private final RedisLiveStageService liveStageService;
    private final ThroughputBuffer throughputBuffer;
    private final RamseyProperties props;
    private final Clock clock;

    public DashboardController(MwClient mwClient, RedisLiveStageService liveStageService,
                              ThroughputBuffer throughputBuffer, RamseyProperties props, Clock clock) {
        this.mwClient = mwClient;
        this.liveStageService = liveStageService;
        this.throughputBuffer = throughputBuffer;
        this.props = props;
        this.clock = clock;
    }

    @GetMapping("/campaigns")
    public List<CampaignDto> campaigns() {
        return mwClient.getCampaigns();
    }

    @GetMapping("/campaigns/{id}/progression")
    public List<ProgressionPointDto> progression(@PathVariable int id) {
        return mwClient.getProgression(id);
    }

    @GetMapping("/stages/{id}/live")
    public LiveStageDto live(@PathVariable int id) {
        return liveStageService.getLiveStage(id);
    }

    @GetMapping("/throughput/history")
    public List<ThroughputSample> history(@RequestParam(required = false) Integer window) {
        int windowSeconds = window != null ? window : props.throughput().defaultWindowSeconds();
        long since = clock.millis() - windowSeconds * 1000L;
        return throughputBuffer.snapshotSince(since);
    }
}
