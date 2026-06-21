package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.model.LiveTick;
import com.setminusx.ramsey.ui.model.ThroughputSample;
import com.setminusx.ramsey.ui.redis.RedisLiveStageService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;

@Component
public class ThroughputSampler {

    private static final Logger log = LoggerFactory.getLogger(ThroughputSampler.class);

    private record Baseline(int stageId, long count, long ts) {}

    private final ActiveStageResolver resolver;
    private final RedisLiveStageService redis;
    private final ThroughputBuffer buffer;
    private final ThroughputBroadcaster broadcaster;
    private final Clock clock;

    private Baseline last;

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
        ActiveStage active = resolver.resolveActiveStage();

        if (active == null) {
            last = null;
            emit(new LiveTick(now, null, 0.0, 0, 0, 0, 0.0, null));
            return;
        }

        int stageId = active.stageId();
        long count = redis.getProcessedCount(stageId);

        double unitsPerSec;
        if (last == null || last.stageId() != stageId) {
            unitsPerSec = 0.0; // re-baseline on first sample / stage change (no cross-stage spike)
        } else {
            double elapsedSec = (now - last.ts()) / 1000.0;
            double delta = count - last.count();
            unitsPerSec = (elapsedSec > 0 && delta > 0) ? delta / elapsedSec : 0.0;
        }
        last = new Baseline(stageId, count, now);

        long workIndex = redis.getWorkIndex(stageId);
        long totalPairs = redis.getTotalPairs(stageId);
        double progressPct = totalPairs > 0 ? Math.min(100.0, (workIndex * 100.0) / totalPairs) : 0.0;

        emit(new LiveTick(now, stageId, unitsPerSec, count, workIndex, totalPairs, progressPct, active.cliqueCount()));
    }

    private void emit(LiveTick tick) {
        buffer.add(new ThroughputSample(tick.ts(), tick.stageId(), tick.unitsPerSec()));
        broadcaster.broadcast(tick);
    }
}
