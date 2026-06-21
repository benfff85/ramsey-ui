package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.model.LiveTick;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

public interface ThroughputBroadcaster {
    void broadcast(LiveTick tick);

    @Component
    class StompThroughputBroadcaster implements ThroughputBroadcaster {
        public static final String TOPIC = "/topic/throughput";
        private final SimpMessagingTemplate messaging;
        public StompThroughputBroadcaster(SimpMessagingTemplate messaging) {
            this.messaging = messaging;
        }
        @Override public void broadcast(LiveTick tick) {
            messaging.convertAndSend(TOPIC, tick);
        }
    }
}
