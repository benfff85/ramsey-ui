package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.client.MwClient;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.util.List;
import java.util.Objects;

@Component
public class ActiveStageResolver {

    private static final long CACHE_MILLIS = 5000;

    private final MwClient mw;
    private final Clock clock;

    private List<ActiveStage> cached = List.of();
    private long cachedAtMillis;
    private boolean haveCached; // first call always computes (avoids a sentinel-overflow guard)

    public ActiveStageResolver(MwClient mw, Clock clock) {
        this.mw = mw;
        this.clock = clock;
    }

    /**
     * The active stage of EVERY campaign currently marked ACTIVE (the system may run several
     * concurrently, e.g. the multi-seed campaign on the local fleet plus the long-running
     * campaign the remote workers grind). Campaigns without an ACTIVE stage are omitted.
     */
    public synchronized List<ActiveStage> resolveActiveStages() {
        long now = clock.millis();
        if (haveCached && now - cachedAtMillis < CACHE_MILLIS) {
            return cached;
        }
        try {
            cached = computeActiveStages();
        } catch (Exception e) {
            cached = List.of(); // mw unreachable -> no active stages; sampler emits an empty tick
        }
        cachedAtMillis = now;
        haveCached = true;
        return cached;
    }

    private List<ActiveStage> computeActiveStages() {
        return mw.getCampaigns().stream()
                .filter(c -> "ACTIVE".equalsIgnoreCase(c.status()))
                .map(c -> mw.getProgression(c.campaignId()).stream()
                        .filter(p -> "ACTIVE".equalsIgnoreCase(p.status()))
                        .map(p -> new ActiveStage(c.campaignId(), p.stageId(), p.cliqueCount()))
                        .findFirst()
                        .orElse(null))
                .filter(Objects::nonNull)
                .toList();
    }
}
