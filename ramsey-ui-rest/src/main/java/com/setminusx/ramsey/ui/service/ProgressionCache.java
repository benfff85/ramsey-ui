package com.setminusx.ramsey.ui.service;

import com.setminusx.ramsey.ui.client.MwClient;
import com.setminusx.ramsey.ui.model.ProgressionPointDto;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.SortedSet;
import java.util.TreeSet;
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

    /** Marker the queue manager writes on a stage created by a perturbation kick. */
    private static final String KICK_PREFIX = "PERTURBATION";

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

    /** The campaign's full progression, index-stamped, from cache when fresh. */
    public List<ProgressionPointDto> get(int campaignId) {
        Entry entry = cache.get(campaignId);
        if (entry != null && entry.isFresh()) {
            return entry.points();
        }
        List<ProgressionPointDto> raw = mwClient.getProgression(campaignId);
        List<ProgressionPointDto> points = new ArrayList<>(raw.size());
        for (int i = 0; i < raw.size(); i++) {
            points.add(raw.get(i).withIdx(i));
        }
        cache.put(campaignId, new Entry(points, System.nanoTime() + TTL_MILLIS * 1_000_000L));
        return points;
    }

    /**
     * At most {@code maxPoints} of the campaign's progression, for clients that cannot take the
     * whole series — it passed 80,000 points and 11 MB, which a phone will not parse.
     *
     * Downsampling cannot be a plain stride: the chart derives structure from specific points, and
     * dropping one of those changes what it reports rather than just how smooth it looks. Kept
     * unconditionally:
     *   - kick markers, which delimit the epochs (drop one and two descents merge into a single
     *     series)
     *   - each epoch's minimum, which is the floor shown in the legend
     *   - the first and last point
     * The remaining budget is spread evenly over everything else. Every point keeps the `idx` it
     * was stamped with, so the x-axis still reads in real stages.
     */
    public List<ProgressionPointDto> sampled(int campaignId, int maxPoints) {
        List<ProgressionPointDto> all = get(campaignId);
        if (maxPoints <= 0 || all.size() <= maxPoints) {
            return all;
        }
        int n = all.size();
        SortedSet<Integer> keep = new TreeSet<>();
        keep.add(0);
        keep.add(n - 1);

        // Kick markers, and the running minimum within each epoch they delimit.
        int epochMinIdx = 0;
        long epochMin = Long.MAX_VALUE;
        for (int i = 0; i < n; i++) {
            ProgressionPointDto p = all.get(i);
            boolean isKick = p.details() != null && p.details().startsWith(KICK_PREFIX);
            if (isKick) {
                if (epochMin != Long.MAX_VALUE) {
                    keep.add(epochMinIdx);
                }
                keep.add(i);
                epochMin = Long.MAX_VALUE;
            }
            if (p.cliqueCount() != null && p.cliqueCount() < epochMin) {
                epochMin = p.cliqueCount();
                epochMinIdx = i;
            }
        }
        if (epochMin != Long.MAX_VALUE) {
            keep.add(epochMinIdx); // final epoch's floor
        }

        int budget = maxPoints - keep.size();
        if (budget > 0) {
            double stride = (double) n / budget;
            for (double at = 0; at < n; at += stride) {
                keep.add((int) at);
            }
        }

        List<ProgressionPointDto> out = new ArrayList<>(keep.size());
        for (int i : keep) {
            out.add(all.get(i));
        }
        return out;
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
