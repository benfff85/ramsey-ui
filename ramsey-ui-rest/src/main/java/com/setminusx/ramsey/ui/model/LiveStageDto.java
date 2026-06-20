package com.setminusx.ramsey.ui.model;

import java.util.List;

public record LiveStageDto(Integer stageId, long processedCount, long workIndex, long totalPairs,
                           double progressPct, List<BestResultDto> bestResults) {}
