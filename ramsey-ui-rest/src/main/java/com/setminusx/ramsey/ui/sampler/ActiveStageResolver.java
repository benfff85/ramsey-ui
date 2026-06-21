package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.client.MwClient;
import com.setminusx.ramsey.ui.model.CampaignDto;
import org.springframework.stereotype.Component;

import java.time.Clock;

@Component
public class ActiveStageResolver {

    private static final long CACHE_MILLIS = 5000;

    private final MwClient mw;
    private final Clock clock;

    private ActiveStage cached;
    private long cachedAtMillis;
    private boolean haveCached; // first call always computes (avoids a sentinel-overflow guard)

    public ActiveStageResolver(MwClient mw, Clock clock) {
        this.mw = mw;
        this.clock = clock;
    }

    public synchronized ActiveStage resolveActiveStage() {
        long now = clock.millis();
        if (haveCached && now - cachedAtMillis < CACHE_MILLIS) {
            return cached;
        }
        try {
            cached = computeActiveStage();
        } catch (Exception e) {
            cached = null; // mw unreachable -> no active stage; sampler emits an empty tick
        }
        cachedAtMillis = now;
        haveCached = true;
        return cached;
    }

    private ActiveStage computeActiveStage() {
        CampaignDto active = mw.getCampaigns().stream()
                .filter(c -> "ACTIVE".equalsIgnoreCase(c.status()))
                .findFirst()
                .orElse(null);
        if (active == null) return null;

        return mw.getProgression(active.campaignId()).stream()
                .filter(p -> "ACTIVE".equalsIgnoreCase(p.status()))
                .map(p -> new ActiveStage(p.stageId(), p.cliqueCount()))
                .findFirst()
                .orElse(null);
    }
}
