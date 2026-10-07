package com.setminusx.ramsey.ui.service;

import com.setminusx.ramsey.ui.client.MwClient;
import com.setminusx.ramsey.ui.model.ProgressionPointDto;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;

/**
 * A bounded, incrementally maintained summary of each campaign's progression.
 *
 * The progression is append-only and unbounded, one point per stage advance. The fleet now
 * advances ~5 stages a second, so campaign 10 passed 3.66M stages (555 MB of JSON) in Oct 2026.
 * This service used to refetch that whole series every few seconds and finally ran out of heap
 * doing it. The OutOfMemoryError killed Tomcat's acceptor thread, and the dashboard refused every
 * connection while the container still reported Up.
 *
 * Now each campaign is read from the middleware once, in pages, and afterwards only the stages
 * after the newest one held. Nothing is retained per stage; what is kept is constant-size:
 * <ul>
 *   <li>kick markers and each epoch's floor. The chart derives its epochs from the kicks and its
 *       legend from the floors, so dropping one changes what it reports rather than how smooth it
 *       looks. These survive unconditionally.</li>
 *   <li>a uniform grid of every {@code stride}-th point. When it fills, the stride doubles and
 *       every other point is dropped, so it always spans the whole series with between
 *       {@link #GRID_CAPACITY}/2 and {@link #GRID_CAPACITY} points.</li>
 *   <li>the newest {@link #RECENT_CAPACITY} points verbatim, for clients polling the tail.</li>
 * </ul>
 * Every point is stamped with its {@code idx}, its position in the full series, as it arrives.
 * The x-axis therefore reads in real stages however sparse the sample.
 */
@Service
public class ProgressionCache {

    /** How long a campaign's summary is served before its tail is re-read from the middleware. */
    static final long REFRESH_MILLIS = 2_000;

    /** Page size for middleware reads; equal to the middleware's own cap, MAX_PROGRESSION_PAGE. */
    static final int PAGE_SIZE = 50_000;

    static final int GRID_CAPACITY = 8_192;

    /** Newest points kept verbatim: a bit over an hour at 5 stages/s. */
    static final int RECENT_CAPACITY = 20_000;

    /** Sample size when a client names none. The full series is never served. */
    static final int DEFAULT_MAX_POINTS = 3_000;

    /** Marker the queue manager writes on a stage created by a perturbation kick. */
    private static final String KICK_PREFIX = "PERTURBATION";

    private final MwClient mwClient;
    private final Clock clock;
    private final Map<Integer, Summary> summaries = new ConcurrentHashMap<>();

    public ProgressionCache(MwClient mwClient, Clock clock) {
        this.mwClient = mwClient;
        this.clock = clock;
    }

    /**
     * At most {@code maxPoints} of the campaign's progression (default {@value #DEFAULT_MAX_POINTS}):
     * the first and newest point, every kick marker, every epoch's floor, and the rest of the
     * budget spread evenly over the grid. Structural points are never dropped, so a campaign with
     * more kicks than budget returns more than {@code maxPoints}. A series that fits the budget
     * (and the grid) comes back whole.
     */
    public List<ProgressionPointDto> sampled(int campaignId, Integer maxPoints) {
        Summary summary = current(campaignId);
        synchronized (summary) {
            return summary.sample(maxPoints == null || maxPoints <= 0 ? DEFAULT_MAX_POINTS : maxPoints);
        }
    }

    /**
     * The points after {@code sinceStageId}, so a client that holds a sample can poll for the tail.
     * A client further behind than the newest {@value #RECENT_CAPACITY} points gets the summary's
     * points across the gap (kicks and floors included) and then the recent points verbatim.
     */
    public List<ProgressionPointDto> since(int campaignId, int sinceStageId) {
        Summary summary = current(campaignId);
        synchronized (summary) {
            return summary.since(sinceStageId);
        }
    }

    private Summary current(int campaignId) {
        Summary summary = summaries.computeIfAbsent(campaignId, id -> new Summary());
        synchronized (summary) {
            long now = clock.millis();
            if (summary.loaded && now - summary.refreshedAt < REFRESH_MILLIS) {
                return summary;
            }
            // Re-read from the newest point held, inclusive: it was probably ACTIVE when first
            // seen, and this is how its status catches up once a newer stage replaces it.
            ProgressionPointDto tip = summary.tip();
            int cursor = tip == null ? 0 : tip.stageId() - 1;
            List<ProgressionPointDto> page;
            do {
                page = mwClient.getProgressionPage(campaignId, cursor, PAGE_SIZE);
                for (ProgressionPointDto point : page) {
                    summary.accept(point);
                }
                if (!page.isEmpty()) {
                    cursor = page.getLast().stageId();
                }
            } while (page.size() == PAGE_SIZE);
            summary.loaded = true;
            summary.refreshedAt = now;
        }
        return summary;
    }

    /** One campaign's summary. Every access holds its monitor. */
    static final class Summary {
        boolean loaded;
        long refreshedAt;

        /** Points seen so far, which is also the next point's idx. */
        private int count;
        private int stride = 1;
        private final ArrayList<ProgressionPointDto> grid = new ArrayList<>();
        private final ArrayList<ProgressionPointDto> kicks = new ArrayList<>();
        /** The minimum of every epoch closed by a kick. */
        private final ArrayList<ProgressionPointDto> floors = new ArrayList<>();
        /** The running minimum of the epoch still open. */
        private ProgressionPointDto epochMin;
        private final ArrayDeque<ProgressionPointDto> recent = new ArrayDeque<>();

        ProgressionPointDto tip() {
            return recent.peekLast();
        }

        void accept(ProgressionPointDto raw) {
            ProgressionPointDto tip = tip();
            if (tip == null || raw.stageId() > tip.stageId()) {
                append(raw.withIdx(count++));
            } else if (raw.stageId().equals(tip.stageId())) {
                refreshTip(raw.withIdx(tip.idx()));
            }
        }

        private void append(ProgressionPointDto p) {
            if (p.details() != null && p.details().startsWith(KICK_PREFIX)) {
                if (epochMin != null) {
                    floors.add(epochMin);
                }
                kicks.add(p);
                epochMin = null;
            }
            // Strictly lower, so the earliest point reaching a floor is the one kept.
            if (p.cliqueCount() != null && (epochMin == null || p.cliqueCount() < epochMin.cliqueCount())) {
                epochMin = p;
            }
            if (p.idx() % stride == 0) {
                grid.add(p);
                if (grid.size() > GRID_CAPACITY) {
                    stride *= 2;
                    grid.removeIf(q -> q.idx() % stride != 0);
                }
            }
            recent.addLast(p);
            if (recent.size() > RECENT_CAPACITY) {
                recent.removeFirst();
            }
        }

        /** The newest point re-read with current values; every structure holding it gets the copy. */
        private void refreshTip(ProgressionPointDto updated) {
            recent.removeLast();
            recent.addLast(updated);
            replaceLast(grid, updated);
            replaceLast(kicks, updated);
            if (epochMin != null && epochMin.stageId().equals(updated.stageId())) {
                epochMin = updated;
            }
        }

        private static void replaceLast(List<ProgressionPointDto> list, ProgressionPointDto updated) {
            if (!list.isEmpty() && list.getLast().stageId().equals(updated.stageId())) {
                list.set(list.size() - 1, updated);
            }
        }

        /** Kicks, floors, the open epoch's floor, the first and the newest point, by idx. */
        private TreeMap<Integer, ProgressionPointDto> structural() {
            TreeMap<Integer, ProgressionPointDto> keep = new TreeMap<>();
            if (!grid.isEmpty()) {
                keep.put(0, grid.getFirst()); // idx 0 is on every stride
            }
            kicks.forEach(p -> keep.put(p.idx(), p));
            floors.forEach(p -> keep.put(p.idx(), p));
            if (epochMin != null) {
                keep.put(epochMin.idx(), epochMin);
            }
            if (tip() != null) {
                keep.put(tip().idx(), tip());
            }
            return keep;
        }

        List<ProgressionPointDto> sample(int maxPoints) {
            TreeMap<Integer, ProgressionPointDto> keep = structural();
            int budget = maxPoints - keep.size();
            int n = grid.size();
            if (budget >= n) {
                grid.forEach(p -> keep.putIfAbsent(p.idx(), p));
            } else {
                for (int j = 0; j < budget; j++) {
                    ProgressionPointDto p = grid.get((int) ((long) j * n / budget));
                    keep.putIfAbsent(p.idx(), p);
                }
            }
            return new ArrayList<>(keep.values());
        }

        List<ProgressionPointDto> since(int sinceStageId) {
            List<ProgressionPointDto> out = new ArrayList<>();
            // Newest first, stopping at the cursor, so a tail poll touches only what it returns.
            Iterator<ProgressionPointDto> newestFirst = recent.descendingIterator();
            while (newestFirst.hasNext()) {
                ProgressionPointDto p = newestFirst.next();
                if (p.stageId() <= sinceStageId) {
                    break;
                }
                out.add(p);
            }
            Collections.reverse(out);

            boolean behindRecent = out.size() == recent.size() && count > recent.size();
            if (behindRecent) {
                int recentStart = recent.getFirst().stageId();
                TreeMap<Integer, ProgressionPointDto> gap = structural();
                grid.forEach(p -> gap.putIfAbsent(p.idx(), p));
                List<ProgressionPointDto> bridge = gap.values().stream()
                        .filter(p -> p.stageId() > sinceStageId && p.stageId() < recentStart)
                        .toList();
                out.addAll(0, bridge);
            }
            return out;
        }
    }
}
