package com.setminusx.ramsey.ui.model;

/**
 * A graph's metadata. {@code edgeData} is deliberately not mapped — it is ~40 KB of bitstring the
 * dashboard never reads, and leaving it off the record keeps it out of the deserialized object.
 */
public record GraphDto(Integer graphId, Integer cliqueCount, Integer vertexCount) {}
