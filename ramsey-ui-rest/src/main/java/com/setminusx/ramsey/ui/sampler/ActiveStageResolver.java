package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.client.MwClient;
import com.setminusx.ramsey.ui.model.GraphDto;
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

    /**
     * Ask the stage table directly rather than scanning a campaign's progression for the point
     * marked ACTIVE.
     *
     * The progression is the whole history — 21 MB and 143,000 points at the time of writing, and
     * it grows with every stage advance — so scanning it for one stage id cost a multi-megabyte
     * query, serialisation and parse every refresh, for a few hundred bytes of answer. Worse, that
     * cost grows without bound while the answer stays the same size.
     */
    private List<ActiveStage> computeActiveStages() {
        return mw.getCampaigns().stream()
                .filter(c -> "ACTIVE".equalsIgnoreCase(c.status()))
                .map(c -> mw.getActiveStages(c.campaignId()).stream()
                        .findFirst()
                        .map(stage -> new ActiveStage(
                                c.campaignId(),
                                stage.stageId(),
                                cliqueCountOf(stage.baseGraphId())))
                        .orElse(null))
                .filter(Objects::nonNull)
                .toList();
    }

    /** The stage's base-graph clique count; null rather than failing the whole refresh. */
    private Long cliqueCountOf(Integer baseGraphId) {
        if (baseGraphId == null) {
            return null;
        }
        try {
            GraphDto graph = mw.getGraph(baseGraphId);
            return graph == null || graph.cliqueCount() == null
                    ? null
                    : graph.cliqueCount().longValue();
        } catch (Exception e) {
            return null;
        }
    }
}
