package com.setminusx.ramsey.ui.model;

public record ProgressionPointDto(Integer stageId, Integer graphId, Long cliqueCount,
                                  String status, String createdDate) {}
