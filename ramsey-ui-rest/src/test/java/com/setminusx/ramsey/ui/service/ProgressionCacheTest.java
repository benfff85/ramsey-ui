package com.setminusx.ramsey.ui.service;

import com.setminusx.ramsey.ui.client.MwClient;
import com.setminusx.ramsey.ui.model.ProgressionPointDto;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ProgressionCacheTest {

    private static final int CAMPAIGN = 10;
    private static final String KICK = "PERTURBATION kick from graph 1 (x1)";

    /** A clock the test moves forward, so refreshes happen exactly when asked for. */
    private static final class SteppedClock extends Clock {
        long millis;

        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return Instant.ofEpochMilli(millis); }
        void step() { millis += ProgressionCache.REFRESH_MILLIS; }
    }

    /**
     * A middleware over {@code visible}, which the test grows to simulate stages arriving. Pages
     * are served like the real endpoint: stage order, after the cursor, at most {@code limit}.
     */
    private static MwClient middleware(List<ProgressionPointDto> visible, AtomicInteger calls) {
        MwClient mw = mock(MwClient.class);
        when(mw.getProgressionPage(eq(CAMPAIGN), anyInt(), anyInt())).thenAnswer(inv -> {
            calls.incrementAndGet();
            int since = inv.getArgument(1);
            int limit = inv.getArgument(2);
            return visible.stream().filter(p -> p.stageId() > since).limit(limit).toList();
        });
        return mw;
    }

    /**
     * A campaign-shaped series: stage ids with gaps (other campaigns interleave), long descents
     * broken by kicks that jump the count back up, a few repeated floors, and every point ACTIVE
     * as the tip was when it was read.
     */
    private static List<ProgressionPointDto> series(int n, long seed) {
        Random rng = new Random(seed);
        List<ProgressionPointDto> out = new ArrayList<>(n);
        int stageId = 5_000;
        long count = 900_000;
        for (int i = 0; i < n; i++) {
            stageId += 1 + rng.nextInt(3);
            boolean kick = i > 0 && rng.nextInt(9_000) == 0;
            if (kick) {
                count = 400_000 + rng.nextInt(400_000);
            } else {
                count = Math.max(25_000, count - rng.nextInt(40) + 12);
            }
            out.add(new ProgressionPointDto(stageId, stageId, count, "INACTIVE", "t" + i,
                    kick ? KICK : "source: EXHAUSTIVE", null));
        }
        return out;
    }

    /** Brute force over the full series: what the sample must always contain. */
    private static Set<Integer> structuralStageIds(List<ProgressionPointDto> all) {
        Set<Integer> want = new HashSet<>();
        want.add(all.getFirst().stageId());
        want.add(all.getLast().stageId());
        ProgressionPointDto min = null;
        for (ProgressionPointDto p : all) {
            if (p.details().startsWith("PERTURBATION")) {
                if (min != null) want.add(min.stageId());
                want.add(p.stageId());
                min = null;
            }
            if (min == null || p.cliqueCount() < min.cliqueCount()) min = p;
        }
        want.add(min.stageId());
        return want;
    }

    private static void assertTrueIdx(List<ProgressionPointDto> out, List<ProgressionPointDto> all) {
        for (int i = 1; i < out.size(); i++) {
            assertThat(out.get(i).idx()).isGreaterThan(out.get(i - 1).idx());
        }
        for (ProgressionPointDto p : out) {
            assertThat(all.get(p.idx()).stageId()).as("idx is the position in the full series")
                    .isEqualTo(p.stageId());
        }
    }

    /**
     * The summary is maintained one refresh at a time, in arbitrary batch sizes. It must end up
     * identical to a summary built from one bulk load of the same series, or the dashboard's chart
     * would depend on when it happened to be polled.
     */
    @Test
    void incrementalSummaryIsIdenticalToABulkLoad() {
        List<ProgressionPointDto> all = series(150_000, 1); // 3 full pages exactly, then an empty one

        AtomicInteger bulkCalls = new AtomicInteger();
        ProgressionCache bulk = new ProgressionCache(middleware(all, bulkCalls), new SteppedClock());
        List<ProgressionPointDto> bulkSample = bulk.sampled(CAMPAIGN, null);
        assertThat(bulkCalls.get()).as("pages until a short page").isEqualTo(4);

        List<ProgressionPointDto> visible = new ArrayList<>();
        SteppedClock clock = new SteppedClock();
        ProgressionCache incremental = new ProgressionCache(middleware(visible, new AtomicInteger()), clock);
        Random rng = new Random(2);
        while (visible.size() < all.size()) {
            int next = Math.min(all.size(), visible.size() + 1 + rng.nextInt(9_000));
            visible.addAll(all.subList(visible.size(), next));
            clock.step();
            incremental.since(CAMPAIGN, visible.getLast().stageId()); // a polling client
        }

        assertThat(incremental.sampled(CAMPAIGN, null)).isEqualTo(bulkSample);
        assertThat(incremental.sampled(CAMPAIGN, Integer.MAX_VALUE))
                .isEqualTo(bulk.sampled(CAMPAIGN, Integer.MAX_VALUE));
        int cursor = all.get(140_000).stageId();
        assertThat(incremental.since(CAMPAIGN, cursor)).isEqualTo(bulk.since(CAMPAIGN, cursor));
    }

    @Test
    void sampleKeepsEveryKickFloorAndEndpoint() {
        List<ProgressionPointDto> all = series(120_000, 3);
        ProgressionCache cache = new ProgressionCache(middleware(all, new AtomicInteger()), new SteppedClock());

        List<ProgressionPointDto> out = cache.sampled(CAMPAIGN, 3_000);

        Set<Integer> want = structuralStageIds(all);
        assertThat(want.size()).as("the series has kicks to keep").isGreaterThan(10);
        assertThat(out).extracting(ProgressionPointDto::stageId).containsAll(want);
        assertThat(out).hasSizeLessThanOrEqualTo(3_000);
        assertTrueIdx(out, all);
    }

    /** Held state must not grow with the campaign, or this service runs out of heap again. */
    @Test
    void heldPointsStayBoundedAsTheSeriesGrows() {
        List<ProgressionPointDto> all = series(400_000, 4);
        ProgressionCache cache = new ProgressionCache(middleware(all, new AtomicInteger()), new SteppedClock());

        int structural = structuralStageIds(all).size();
        List<ProgressionPointDto> everythingHeld = cache.sampled(CAMPAIGN, Integer.MAX_VALUE);
        assertThat(everythingHeld.size())
                .isGreaterThan(ProgressionCache.GRID_CAPACITY / 2)
                .isLessThanOrEqualTo(ProgressionCache.GRID_CAPACITY + structural);
        assertTrueIdx(everythingHeld, all);
    }

    @Test
    void tailPollReturnsOnlyNewerPointsWithTheirTrueIdx() {
        List<ProgressionPointDto> all = series(10_000, 5);
        List<ProgressionPointDto> visible = new ArrayList<>(all.subList(0, 9_995));
        SteppedClock clock = new SteppedClock();
        ProgressionCache cache = new ProgressionCache(middleware(visible, new AtomicInteger()), clock);
        int heldTip = cache.sampled(CAMPAIGN, null).getLast().stageId();

        visible.addAll(all.subList(9_995, 10_000));
        clock.step();
        List<ProgressionPointDto> tail = cache.since(CAMPAIGN, heldTip);

        assertThat(tail).extracting(ProgressionPointDto::idx).containsExactly(9_995, 9_996, 9_997, 9_998, 9_999);
        assertTrueIdx(tail, all);
        assertThat(cache.since(CAMPAIGN, all.getLast().stageId())).isEmpty();
    }

    /**
     * A client further behind than the verbatim window still gets every kick and floor across the
     * gap, then the newest points without a hole.
     */
    @Test
    void clientBehindTheRecentWindowGetsTheStructureAcrossTheGap() {
        List<ProgressionPointDto> all = series(100_000, 6);
        ProgressionCache cache = new ProgressionCache(middleware(all, new AtomicInteger()), new SteppedClock());
        int since = all.get(10).stageId();

        List<ProgressionPointDto> out = cache.since(CAMPAIGN, since);

        Set<Integer> want = new HashSet<>(structuralStageIds(all.subList(11, all.size())));
        want.removeIf(id -> !structuralStageIds(all).contains(id)); // a sub-series' own first point is not structural
        assertThat(out).extracting(ProgressionPointDto::stageId).containsAll(want);
        List<ProgressionPointDto> newest = all.subList(all.size() - ProgressionCache.RECENT_CAPACITY, all.size());
        assertThat(out.subList(out.size() - newest.size(), out.size()))
                .extracting(ProgressionPointDto::stageId)
                .containsExactlyElementsOf(newest.stream().map(ProgressionPointDto::stageId).toList());
        assertThat(out).allSatisfy(p -> assertThat(p.stageId()).isGreaterThan(since));
        assertTrueIdx(out, all);
    }

    /** The tip is read while ACTIVE; once a newer stage replaces it, its status must catch up. */
    @Test
    void tipStatusCatchesUpWhenANewerStageArrives() {
        List<ProgressionPointDto> visible = new ArrayList<>(List.of(
                new ProgressionPointDto(41, 1, 900L, "INACTIVE", "a", "source", null),
                new ProgressionPointDto(42, 2, 800L, "ACTIVE", "b", "source", null)));
        SteppedClock clock = new SteppedClock();
        ProgressionCache cache = new ProgressionCache(middleware(visible, new AtomicInteger()), clock);
        assertThat(cache.sampled(CAMPAIGN, null)).extracting(ProgressionPointDto::status)
                .containsExactly("INACTIVE", "ACTIVE");

        visible.set(1, new ProgressionPointDto(42, 2, 800L, "INACTIVE", "b", "source", null));
        visible.add(new ProgressionPointDto(45, 3, 700L, "ACTIVE", "c", "source", null));
        clock.step();

        assertThat(cache.sampled(CAMPAIGN, null))
                .extracting(ProgressionPointDto::stageId, ProgressionPointDto::status, ProgressionPointDto::idx)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(41, "INACTIVE", 0),
                        org.assertj.core.groups.Tuple.tuple(42, "INACTIVE", 1),
                        org.assertj.core.groups.Tuple.tuple(45, "ACTIVE", 2));
        assertThat(cache.since(CAMPAIGN, 41)).extracting(ProgressionPointDto::status)
                .containsExactly("INACTIVE", "ACTIVE");
    }

    @Test
    void readsTheMiddlewareAtMostOncePerRefreshInterval() {
        List<ProgressionPointDto> visible = new ArrayList<>(series(100, 7));
        AtomicInteger calls = new AtomicInteger();
        SteppedClock clock = new SteppedClock();
        ProgressionCache cache = new ProgressionCache(middleware(visible, calls), clock);

        for (int i = 0; i < 50; i++) {
            cache.since(CAMPAIGN, 0);
            cache.sampled(CAMPAIGN, 300);
        }
        assertThat(calls.get()).isEqualTo(1);

        clock.step();
        cache.sampled(CAMPAIGN, 300);
        assertThat(calls.get()).isEqualTo(2);
    }
}
