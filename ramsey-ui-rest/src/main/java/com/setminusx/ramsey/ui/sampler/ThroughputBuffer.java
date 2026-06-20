package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.model.ThroughputSample;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

public class ThroughputBuffer {

    private final int capacity;
    private final Deque<ThroughputSample> samples = new ArrayDeque<>();

    public ThroughputBuffer(int capacity) {
        this.capacity = capacity;
    }

    public synchronized void add(ThroughputSample sample) {
        samples.addLast(sample);
        while (samples.size() > capacity) {
            samples.removeFirst();
        }
    }

    public synchronized List<ThroughputSample> snapshot() {
        return new ArrayList<>(samples);
    }

    public synchronized List<ThroughputSample> snapshotSince(long sinceTsMillis) {
        List<ThroughputSample> out = new ArrayList<>();
        for (ThroughputSample s : samples) {
            if (s.ts() >= sinceTsMillis) out.add(s);
        }
        return out;
    }
}
