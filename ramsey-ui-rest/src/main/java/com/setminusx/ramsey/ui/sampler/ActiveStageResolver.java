package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.client.MwClient;
import com.setminusx.ramsey.ui.model.CampaignDto;
import com.setminusx.ramsey.ui.model.ProgressionPointDto;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.util.List;

@Component
public class ActiveStageResolver {

    private static final long CACHE_MILLIS = 5000;

    private final MwClient mw;
    private final Clock clock;

    private Integer cachedStageId;
    private long cachedAtMillis;
    private boolean cached;

    public ActiveStageResolver(MwClient mw, Clock clock) {
        this.mw = mw;
        this.clock = clock;
    }

    public synchronized Integer resolveActiveStageId() {
        long now = clock.millis();
        if (cached && now - cachedAtMillis < CACHE_MILLIS) {
            return cachedStageId;
        }
        try {
            cachedStageId = computeActiveStageId();
        } catch (Exception e) {
            cachedStageId = null; // mw unreachable -> no active stage; sampler emits 0
        }
        cachedAtMillis = now;
        cached = true;
        return cachedStageId;
    }

    private Integer computeActiveStageId() {
        CampaignDto active = mw.getCampaigns().stream()
                .filter(c -> "ACTIVE".equalsIgnoreCase(c.status()))
                .findFirst()
                .orElse(null);
        if (active == null) return null;

        List<ProgressionPointDto> prog = mw.getProgression(active.campaignId());
        return prog.stream()
                .filter(p -> "ACTIVE".equalsIgnoreCase(p.status()))
                .map(ProgressionPointDto::stageId)
                .findFirst()
                .orElse(null);
    }
}
