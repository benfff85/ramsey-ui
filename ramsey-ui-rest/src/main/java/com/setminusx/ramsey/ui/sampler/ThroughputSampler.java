package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.model.ThroughputSample;
import com.setminusx.ramsey.ui.redis.StageCounterReader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;

@Component
public class ThroughputSampler {

    private static final Logger log = LoggerFactory.getLogger(ThroughputSampler.class);

    private record Baseline(Integer stageId, long count, long ts) {}

    private final ActiveStageResolver resolver;
    private final StageCounterReader counterReader;
    private final ThroughputBuffer buffer;
    private final ThroughputBroadcaster broadcaster;
    private final Clock clock;

    private Baseline last;

    public ThroughputSampler(ActiveStageResolver resolver, StageCounterReader counterReader,
                             ThroughputBuffer buffer, ThroughputBroadcaster broadcaster, Clock clock) {
        this.resolver = resolver;
        this.counterReader = counterReader;
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
            log.debug("throughput sample skipped: {}", e.toString());
        }
    }

    private void doSample() {
        long now = clock.millis();
        Integer stageId = resolver.resolveActiveStageId();

        if (stageId == null) {
            last = null;
            emit(new ThroughputSample(now, null, 0.0));
            return;
        }

        long count = counterReader.readProcessedCount(stageId);

        if (last == null || !stageId.equals(last.stageId())) {
            last = new Baseline(stageId, count, now);
            emit(new ThroughputSample(now, stageId, 0.0));
            return;
        }

        double elapsedSec = (now - last.ts()) / 1000.0;
        double unitsPerSec = 0.0;
        if (elapsedSec > 0) {
            double delta = count - last.count();
            unitsPerSec = delta > 0 ? delta / elapsedSec : 0.0;
        }
        last = new Baseline(stageId, count, now);
        emit(new ThroughputSample(now, stageId, unitsPerSec));
    }

    private void emit(ThroughputSample sample) {
        buffer.add(sample);
        broadcaster.broadcast(sample);
    }
}
