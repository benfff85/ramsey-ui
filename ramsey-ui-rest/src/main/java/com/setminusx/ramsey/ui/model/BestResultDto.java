package com.setminusx.ramsey.ui.model;

import java.util.List;

public record BestResultDto(long cliqueCount, List<List<Integer>> edges, boolean fullGraph) {}
