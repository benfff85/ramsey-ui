package com.setminusx.ramsey.ui.redis;

public final class StageKeys {
    private StageKeys() {}
    // Throughput source. Fallback per spec: change to "stage_work_index:".
    public static final String PROCESSED_COUNT = "processed_count:";
    public static final String WORK_INDEX = "stage_work_index:";
    public static final String STAGE_CONFIG = "stage_config:";
    public static final String BEST_RESULTS = "best_results:";
}
