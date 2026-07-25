package com.setminusx.ramsey.ui.service;

import com.setminusx.ramsey.ui.client.MwClient;
import com.setminusx.ramsey.ui.model.ProgressionPointDto;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Short-lived cache of a campaign's progression.
 *
 * The progression is append-only and unbounded — it grows one point per stage advance, which
 * during a post-kick descent is more than once a second, and a campaign that has been running a
 * while is already tens of thousands of points and several megabytes of JSON. The dashboard
 * refetches whenever the live stage advances, so without this every advance cost a full
 * campaign-wide query in the middleware plus two serialisations of the whole history.
 *
 * A few seconds of staleness is invisible on a dashboard, so caching here bounds that cost to one
 * fetch per TTL regardless of how fast stages are advancing.
 */
@Service
public class ProgressionCache {

    private static final long TTL_MILLIS = 3_000;

    private final MwClient mwClient;

    public ProgressionCache(MwClient mwClient) {
        this.mwClient = mwClient;
    }

    private record Entry(List<ProgressionPointDto> points, long expiresAtNanos) {
        boolean isFresh() {
            return System.nanoTime() < expiresAtNanos;
        }
    }

    private final Map<Integer, Entry> cache = new ConcurrentHashMap<>();

    /** The campaign's full progression, from cache when fresh. */
    public List<ProgressionPointDto> get(int campaignId) {
        Entry entry = cache.get(campaignId);
        if (entry != null && entry.isFresh()) {
            return entry.points();
        }
        List<ProgressionPointDto> points = mwClient.getProgression(campaignId);
        cache.put(campaignId, new Entry(points, System.nanoTime() + TTL_MILLIS * 1_000_000L));
        return points;
    }

    /**
     * Only the points after {@code sinceStageId}, so a client that already holds the history can
     * poll for the tail instead of re-downloading megabytes on every stage advance.
     */
    public List<ProgressionPointDto> since(int campaignId, int sinceStageId) {
        return get(campaignId).stream()
                .filter(p -> p.stageId() != null && p.stageId() > sinceStageId)
                .toList();
    }
}
