package com.setminusx.ramsey.ui.model;

/**
 * One stage in a campaign's progression.
 *
 * {@code idx} is the point's position in the campaign's full ordered series. It is assigned
 * server-side BEFORE any downsampling, so the dashboard can plot true "stages since kick" even
 * when it only received a sample — array position would compress the axis.
 */
public record ProgressionPointDto(Integer stageId, Integer graphId, Long cliqueCount,
                                  String status, String createdDate, String details,
                                  Integer idx) {

    public ProgressionPointDto withIdx(int i) {
        return new ProgressionPointDto(stageId, graphId, cliqueCount, status, createdDate, details, i);
    }
}
