package com.setminusx.ramsey.ui.sampler;

/** The currently-active stage of one ACTIVE campaign, with its graph's clique count. */
public record ActiveStage(int campaignId, int stageId, Long cliqueCount) {}
