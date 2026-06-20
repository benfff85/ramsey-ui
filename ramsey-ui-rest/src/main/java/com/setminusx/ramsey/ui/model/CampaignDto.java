package com.setminusx.ramsey.ui.model;

public record CampaignDto(Integer campaignId, Integer subgraphSize, Integer vertexCount, Long totalPairs,
                          String strategy, String status, String createdDate, String updatedDate) {}
