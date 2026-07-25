package com.setminusx.ramsey.ui.redis;

public final class StageKeys {
    private StageKeys() {}
    // Throughput source. Fallback per spec: change to "stage_work_index:".
    public static final String PROCESSED_COUNT = "processed_count:";
    /**
     * Campaign-scoped running total of work units. Unlike PROCESSED_COUNT this is never reset,
     * so it can be differenced across stage boundaries — which matters because stages now advance
     * faster than the sampler ticks.
     */
    public static final String PROCESSED_TOTAL = "processed_total:";
    public static final String WORK_INDEX = "stage_work_index:";
    public static final String STAGE_CONFIG = "stage_config:";
    public static final String BEST_RESULTS = "best_results:";
}
