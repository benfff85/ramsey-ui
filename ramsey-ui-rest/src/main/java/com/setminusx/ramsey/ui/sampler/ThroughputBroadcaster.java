package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.model.ThroughputSample;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

public interface ThroughputBroadcaster {
    void broadcast(ThroughputSample sample);

    @Component
    class StompThroughputBroadcaster implements ThroughputBroadcaster {
        public static final String TOPIC = "/topic/throughput";
        private final SimpMessagingTemplate messaging;
        public StompThroughputBroadcaster(SimpMessagingTemplate messaging) {
            this.messaging = messaging;
        }
        @Override public void broadcast(ThroughputSample sample) {
            messaging.convertAndSend(TOPIC, sample);
        }
    }
}
