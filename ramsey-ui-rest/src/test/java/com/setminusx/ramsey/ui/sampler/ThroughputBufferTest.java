package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.model.ThroughputSample;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ThroughputBufferTest {

    @Test
    void evicts_oldest_beyond_capacity() {
        ThroughputBuffer buffer = new ThroughputBuffer(3);
        for (int i = 1; i <= 5; i++) buffer.add(new ThroughputSample(i, 1, i));
        List<ThroughputSample> all = buffer.snapshot();
        assertThat(all).hasSize(3);
        assertThat(all.get(0).ts()).isEqualTo(3); // 1 and 2 evicted
        assertThat(all.get(2).ts()).isEqualTo(5);
    }

    @Test
    void snapshot_since_filters_by_timestamp() {
        ThroughputBuffer buffer = new ThroughputBuffer(100);
        buffer.add(new ThroughputSample(1000, 1, 10));
        buffer.add(new ThroughputSample(2000, 1, 20));
        buffer.add(new ThroughputSample(3000, 1, 30));
        assertThat(buffer.snapshotSince(2000)).extracting(ThroughputSample::ts)
                .containsExactly(2000L, 3000L);
    }
}
