package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.model.LiveTick;
import com.setminusx.ramsey.ui.model.ThroughputSample;
import com.setminusx.ramsey.ui.redis.RedisLiveStageService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Component
public class ThroughputSampler {

    private static final Logger log = LoggerFactory.getLogger(ThroughputSampler.class);

    /**
     * Previous reading for a campaign. `count` is the campaign-scoped running total, so it
     * survives stage advances; `stageId` is retained only for the legacy per-stage fallback.
     */
    private record Baseline(int stageId, long count, long ts) {}

    private final ActiveStageResolver resolver;
    private final RedisLiveStageService redis;
    private final ThroughputBuffer buffer;
    private final ThroughputBroadcaster broadcaster;
    private final Clock clock;

    // per-campaign baselines: each ACTIVE campaign's rate is computed independently
    private final Map<Integer, Baseline> last = new HashMap<>();

    public ThroughputSampler(ActiveStageResolver resolver, RedisLiveStageService redis,
                             ThroughputBuffer buffer, ThroughputBroadcaster broadcaster, Clock clock) {
        this.resolver = resolver;
        this.redis = redis;
        this.buffer = buffer;
        this.broadcaster = broadcaster;
        this.clock = clock;
    }

    @Scheduled(fixedRateString = "${ramsey.sampler.interval-ms}")
    public void sample() {
        try {
            doSample();
        } catch (Exception e) {
            // Transient dependency failure (e.g., Redis blip). Skip this tick and keep the
            // baseline so the next successful read averages throughput across the gap.
            log.debug("live tick skipped: {}", e.toString());
        }
    }

    private void doSample() {
        long now = clock.millis();
        List<ActiveStage> actives = resolver.resolveActiveStages();

        if (actives.isEmpty()) {
            last.clear();
            emit(new LiveTick(now, null, null, 0.0, 0, 0, 0, 0.0, null));
            return;
        }

        // drop baselines of campaigns that are no longer active (banked/rotated away)
        Set<Integer> activeIds = actives.stream().map(ActiveStage::campaignId).collect(Collectors.toSet());
        last.keySet().retainAll(activeIds);

        for (ActiveStage active : actives) {
            try {
                sampleCampaign(now, active);
            } catch (Exception e) {
                // one campaign's Redis blip must not starve the others' ticks
                log.debug("live tick skipped for campaign {}: {}", active.campaignId(), e.toString());
            }
        }
    }

    private void sampleCampaign(long now, ActiveStage active) {
        int campaignId = active.campaignId();
        int stageId = active.stageId();

        // Difference the CAMPAIGN total, not the per-stage counter. The per-stage counter is
        // deleted when a stage advances, so differencing it forced a re-baseline (a 0.0 reading)
        // on every turnover. That was fine when stages lasted minutes, but near the floor they
        // now advance faster than this sampler ticks, so almost every reading was 0 and fleet
        // throughput appeared an order of magnitude below reality.
        long total = redis.getProcessedTotal(campaignId);
        boolean haveTotal = total > 0;
        long count = haveTotal ? total : redis.getProcessedCount(stageId);

        Baseline base = last.get(campaignId);
        double unitsPerSec;
        // Without the campaign total (workers not yet carrying it) fall back to the old per-stage
        // behaviour, which still needs its re-baseline on a stage change.
        boolean mustRebaseline = base == null || (!haveTotal && base.stageId() != stageId);
        if (mustRebaseline) {
            unitsPerSec = 0.0;
        } else {
            double elapsedSec = (now - base.ts()) / 1000.0;
            double delta = count - base.count();
            // A negative delta means the counter restarted (Redis flush, or the fallback switching
            // stages); treat it as a re-baseline rather than a spike.
            unitsPerSec = (elapsedSec > 0 && delta > 0) ? delta / elapsedSec : 0.0;
        }
        last.put(campaignId, new Baseline(stageId, count, now));

        long workIndex = redis.getWorkIndex(stageId);
        long totalPairs = redis.getTotalPairs(stageId);
        double progressPct = totalPairs > 0 ? Math.min(100.0, (workIndex * 100.0) / totalPairs) : 0.0;

        emit(new LiveTick(now, campaignId, stageId, unitsPerSec, count, workIndex, totalPairs,
                progressPct, active.cliqueCount()));
    }

    private void emit(LiveTick tick) {
        buffer.add(new ThroughputSample(tick.ts(), tick.campaignId(), tick.stageId(), tick.unitsPerSec()));
        broadcaster.broadcast(tick);
    }
}
