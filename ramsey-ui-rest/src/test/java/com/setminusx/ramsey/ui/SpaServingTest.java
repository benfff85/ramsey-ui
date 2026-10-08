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

    private String header(String path, String name) throws Exception {
        HttpResponse<Void> resp = HttpClient.newHttpClient().send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET().build(),
                HttpResponse.BodyHandlers.discarding());
        return resp.headers().firstValue(name).orElse("");
    }

    /**
     * index.html names the current bundle, so a browser must revalidate it on every load. Without
     * a Cache-Control header browsers cache it heuristically for hours, and an open dashboard kept
     * running the previous build (and its removed API calls) after a deploy (2026-10-08).
     */
    @Test
    void index_html_is_revalidated_on_every_load() throws Exception {
        assertThat(header("/", "Cache-Control")).contains("no-cache");
    }

    /** Assets are named by content hash, so a changed file always gets a new name. */
    @Test
    void hashed_assets_are_cached_long_term() throws Exception {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("/assets/[A-Za-z0-9_.-]+\\.js").matcher(get("/"));
        assertThat(m.find()).as("index.html references a hashed bundle").isTrue();
        assertThat(header(m.group(), "Cache-Control")).contains("max-age=31536000").contains("immutable");
    }

    @Test
    void health_is_up() throws Exception {
        assertThat(get("/actuator/health")).contains("\"status\":\"UP\"");
    }
}
