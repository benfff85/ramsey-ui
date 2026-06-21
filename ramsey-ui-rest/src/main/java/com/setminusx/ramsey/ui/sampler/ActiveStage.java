package com.setminusx.ramsey.ui.sampler;

/** The currently-active stage of the active campaign, with its graph's clique count. */
public record ActiveStage(int stageId, Long cliqueCount) {}
