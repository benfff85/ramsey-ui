package com.setminusx.ramsey.ui.web;

import com.setminusx.ramsey.ui.client.MwClient;
import com.setminusx.ramsey.ui.config.RamseyProperties;
import com.setminusx.ramsey.ui.model.*;
import com.setminusx.ramsey.ui.redis.RedisLiveStageService;
import com.setminusx.ramsey.ui.sampler.ThroughputBuffer;
import com.setminusx.ramsey.ui.service.ProgressionCache;
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
    private final ProgressionCache progressionCache;

    public DashboardController(MwClient mwClient, RedisLiveStageService liveStageService,
                              ThroughputBuffer throughputBuffer, RamseyProperties props, Clock clock,
                              ProgressionCache progressionCache) {
        this.mwClient = mwClient;
        this.liveStageService = liveStageService;
        this.throughputBuffer = throughputBuffer;
        this.props = props;
        this.clock = clock;
        this.progressionCache = progressionCache;
    }

    @GetMapping("/campaigns")
    public List<CampaignDto> campaigns() {
        return mwClient.getCampaigns();
    }

    @GetMapping("/fleets")
    public List<FleetDto> fleets() {
        return mwClient.getFleets();
    }

    /**
     * A campaign's progression, always bounded: a structural sample of at most {@code maxPoints}
     * (see {@link ProgressionCache#sampled}), or with {@code sinceStageId} only the points after
     * that stage, so the dashboard can hold a sample and poll for the tail. The full series is
     * never served — it passed 3.66M points and 555 MB.
     */
    @GetMapping("/campaigns/{id}/progression")
    public List<ProgressionPointDto> progression(@PathVariable int id,
                                                 @RequestParam(required = false) Integer sinceStageId,
                                                 @RequestParam(required = false) Integer maxPoints) {
        if (sinceStageId != null) {
            return progressionCache.since(id, sinceStageId);
        }
        return progressionCache.sampled(id, maxPoints);
    }

    @GetMapping("/stages/{id}/live")
    public LiveStageDto live(@PathVariable int id) {
        return liveStageService.getLiveStage(id);
    }

    @GetMapping("/throughput/history")
    public List<ThroughputSample> history(@RequestParam(required = false) Integer window,
                                          @RequestParam(required = false) Integer campaignId) {
        int windowSeconds = window != null ? window : props.throughput().defaultWindowSeconds();
        long since = clock.millis() - windowSeconds * 1000L;
        List<ThroughputSample> samples = throughputBuffer.snapshotSince(since);
        if (campaignId == null) {
            return samples;
        }
        return samples.stream().filter(s -> campaignId.equals(s.campaignId())).toList();
    }
}
