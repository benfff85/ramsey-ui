package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.model.ThroughputSample;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.messaging.converter.JacksonJsonMessageConverter;
import org.springframework.messaging.simp.stomp.*;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;

import java.lang.reflect.Type;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
// Raise the sampler interval so the @Scheduled sampler does not broadcast noise during the test.
@TestPropertySource(properties = "ramsey.sampler.interval-ms=3600000")
class ThroughputWebSocketIT {

    @LocalServerPort int port;
    @Autowired ThroughputBroadcaster broadcaster;

    @Test
    void client_receives_broadcast_sample() throws Exception {
        WebSocketStompClient stomp = new WebSocketStompClient(new StandardWebSocketClient());
        stomp.setMessageConverter(new JacksonJsonMessageConverter());

        CompletableFuture<ThroughputSample> received = new CompletableFuture<>();
        StompSession session = stomp.connectAsync("ws://localhost:" + port + "/ws",
                new StompSessionHandlerAdapter() {}).get(5, TimeUnit.SECONDS);

        session.subscribe("/topic/throughput", new StompFrameHandler() {
            @Override public Type getPayloadType(StompHeaders headers) { return ThroughputSample.class; }
            @Override public void handleFrame(StompHeaders headers, Object payload) {
                ThroughputSample s = (ThroughputSample) payload;
                // Ignore any incidental sampler ticks; complete only on our explicit sample.
                if (s.stageId() != null && s.stageId() == 42) received.complete(s);
            }
        });

        Thread.sleep(200); // allow subscription to register
        broadcaster.broadcast(new ThroughputSample(123L, 42, 999.0));

        ThroughputSample got = received.get(5, TimeUnit.SECONDS);
        assertThat(got.stageId()).isEqualTo(42);
        assertThat(got.unitsPerSec()).isEqualTo(999.0);
    }
}
