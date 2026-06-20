package com.setminusx.ramsey.ui.config;

import com.setminusx.ramsey.ui.sampler.ThroughputBuffer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class ThroughputConfig {
    @Bean
    ThroughputBuffer throughputBuffer(RamseyProperties props) {
        return new ThroughputBuffer(props.throughput().bufferCapacity());
    }
}
