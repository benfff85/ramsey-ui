package com.setminusx.ramsey.ui.model;

public record ThroughputSample(long ts, Integer campaignId, Integer stageId, double unitsPerSec) {}
