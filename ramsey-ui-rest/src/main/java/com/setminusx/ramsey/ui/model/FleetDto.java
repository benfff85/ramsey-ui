package com.setminusx.ramsey.ui.model;

/** A fleet's current target + state (fleet abstraction). */
public record FleetDto(String platform, Integer campaignId, String status, String note, String updatedDate) {}
