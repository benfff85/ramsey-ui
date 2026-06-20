package com.setminusx.ramsey.ui;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SpaServingTest {

    @LocalServerPort
    int port;

    private String get(String path) throws Exception {
        HttpResponse<String> resp = HttpClient.newHttpClient().send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET().build(),
                HttpResponse.BodyHandlers.ofString());
        return resp.body();
    }

    @Test
    void serves_index_html_at_root() throws Exception {
        assertThat(get("/")).contains("<div id=\"root\">");
    }

    @Test
    void health_is_up() throws Exception {
        assertThat(get("/actuator/health")).contains("\"status\":\"UP\"");
    }
}
