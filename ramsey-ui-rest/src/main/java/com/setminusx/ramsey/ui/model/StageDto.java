package com.setminusx.ramsey.ui.model;

/** A stage as the middleware reports it. Only the fields the dashboard needs are mapped. */
public record StageDto(Integer stageId, Integer campaignId, Integer baseGraphId, String status) {}
