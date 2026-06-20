package com.setminusx.ramsey.ui.redis;

public interface StageCounterReader {
    long readProcessedCount(int stageId);
}
