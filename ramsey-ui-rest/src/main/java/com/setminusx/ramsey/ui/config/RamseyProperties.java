package com.setminusx.ramsey.ui.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "ramsey")
public record RamseyProperties(String apiBaseUrl, Sampler sampler, Throughput throughput) {
    public record Sampler(long intervalMs) {}
    public record Throughput(int bufferCapacity, int defaultWindowSeconds) {}
}
