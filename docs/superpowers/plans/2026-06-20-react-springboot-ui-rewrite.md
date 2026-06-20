# React + Spring Boot UI Rewrite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Streamlit `ramsey-ui` with a multi-module Maven project — a React SPA (`ramsey-ui-web`) served by a read-only Spring Boot backend-for-frontend (`ramsey-ui-rest`) that samples work-units/sec into an in-memory ring buffer and pushes it live over a STOMP WebSocket, with full parity to the old dashboard plus a real-time throughput graph.

**Architecture:** `ramsey-ui-rest` reads Redis directly for live counters and proxies ramsey-mw's REST API for campaign/progression history; it never writes. A 1-second `@Scheduled` sampler diffs `processed_count` into a ring buffer and broadcasts each sample to `/topic/throughput`. `ramsey-ui-web` is a Vite/React/TypeScript SPA built by Maven and packaged into the backend jar (served from `META-INF/resources`), so the whole thing ships as one container on port 36003.

**Tech Stack:** Java 25, Spring Boot 4.1.0 (Spring Framework 7, Jackson 3 `tools.jackson`), Spring WebSocket/STOMP, Spring Data Redis; React 18 + TypeScript + Vite, Recharts, `@stomp/stompjs`, Vitest + React Testing Library; frontend-maven-plugin; Docker multi-stage.

## Global Constraints

- **Java release:** 25 (`maven-compiler-plugin` `<release>25</release>`), matching ramsey-mw.
- **Spring Boot parent:** `4.1.0` (matches ramsey-mw exactly). Jackson is v3 — import `tools.jackson.databind.ObjectMapper`, NOT `com.fasterxml.jackson`.
- **groupId:** `com.setminusx`. Base package: `com.setminusx.ramsey.ui`.
- **Backend is read-only.** It may only read Redis and call mw via HTTP GET. It must never write Redis keys, never call mw POST/PUT/DELETE, never touch MySQL.
- **Ports:** backend listens on `8080` internally; external mapping stays `36003:8080`. Preserve env var names `API_BASE_URL`, `REDIS_HOST`, `REDIS_PORT`.
- **Redis keys (read-only, exact):** `processed_count:{stageId}`, `stage_work_index:{stageId}`, `stage_config:{stageId}` (JSON, field `totalPairs`), `best_results:{stageId}` (sorted set; score = clique count; member = JSON).
- **mw endpoints consumed:** `GET /api/ramsey/campaigns`, `GET /api/ramsey/campaigns/{id}/progression`.
- **Throughput source:** `processed_count` delta. The Redis key string lives in ONE constant (`StageKeys.PROCESSED_COUNT`) so the documented fallback to `stage_work_index` is a one-line change.
- **No Portainer/prod deploy.** Edit compose files locally only.
- **Commit trailer:** end every commit message with:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0169KJrUT5NQv2VBFWy9UuKt
  ```

## Shared Contract (types used across tasks)

**Backend (`com.setminusx.ramsey.ui.model`), all Java records:**
```java
public record ThroughputSample(long ts, Integer stageId, double unitsPerSec) {}
public record BestResultDto(long cliqueCount, java.util.List<java.util.List<Integer>> edges, boolean fullGraph) {}
public record LiveStageDto(Integer stageId, long processedCount, long workIndex, long totalPairs, double progressPct, java.util.List<BestResultDto> bestResults) {}
public record CampaignDto(Integer campaignId, Integer subgraphSize, Integer vertexCount, Long totalPairs, String strategy, String status, String createdDate, String updatedDate) {}
public record ProgressionPointDto(Integer stageId, Integer graphId, Long cliqueCount, String status, String createdDate) {}
```

**REST (all under `/api/dashboard`):**
- `GET /campaigns` → `CampaignDto[]`
- `GET /campaigns/{id}/progression` → `ProgressionPointDto[]`
- `GET /stages/{id}/live` → `LiveStageDto`
- `GET /throughput/history?window={seconds}` → `ThroughputSample[]` (default window 7200)

**WebSocket:** STOMP endpoint `/ws` (native, no SockJS); broker prefix `/topic`; broadcast destination `/topic/throughput` carrying one `ThroughputSample` per tick.

**Frontend mirror types (`src/types.ts`):** identical field names; `ThroughputSample { ts: number; stageId: number | null; unitsPerSec: number }`.

---

## Task 1: Project skeleton — parent pom + React module built into a jar

**Files:**
- Create: `pom.xml` (parent)
- Create: `ramsey-ui-web/pom.xml`
- Create: `ramsey-ui-web/package.json`, `ramsey-ui-web/vite.config.ts`, `ramsey-ui-web/tsconfig.json`, `ramsey-ui-web/index.html`, `ramsey-ui-web/src/main.tsx`, `ramsey-ui-web/src/App.tsx`
- Create: `ramsey-ui-web/.gitignore`

**Interfaces:**
- Produces: a Maven module `com.setminusx:ramsey-ui-web:0.1.0` (packaging `jar`) whose jar contains the built SPA under `META-INF/resources/` (so Spring Boot serves it from the classpath).

- [ ] **Step 1: Parent `pom.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.setminusx</groupId>
    <artifactId>ramsey-ui</artifactId>
    <version>0.1.0</version>
    <packaging>pom</packaging>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>4.1.0</version>
        <relativePath/>
    </parent>

    <properties>
        <java.version>25</java.version>
        <node.version>v22.11.0</node.version>
        <frontend-maven-plugin.version>1.15.1</frontend-maven-plugin.version>
    </properties>

    <modules>
        <module>ramsey-ui-web</module>
        <module>ramsey-ui-rest</module>
    </modules>
</project>
```

- [ ] **Step 2: `ramsey-ui-web/package.json`**

```json
{
  "name": "ramsey-ui-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "recharts": "^2.12.7",
    "@stomp/stompjs": "^7.0.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.1",
    "@testing-library/jest-dom": "^6.4.6",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^24.1.0",
    "typescript": "^5.5.3",
    "vite": "^5.3.4",
    "vitest": "^2.0.4"
  }
}
```

- [ ] **Step 3: `ramsey-ui-web/vite.config.ts`** — build into the jar's `META-INF/resources` and proxy API/WS to the backend during `npm run dev`.

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'target/classes/META-INF/resources',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

- [ ] **Step 4: `ramsey-ui-web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"]
}
```

- [ ] **Step 5: `ramsey-ui-web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Ramsey Progress</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: `ramsey-ui-web/src/main.tsx` and `src/App.tsx`** (placeholder app, fleshed out in later tasks)

`src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`src/App.tsx`:
```tsx
export default function App() {
  return <h1>Ramsey Progress</h1>;
}
```

- [ ] **Step 7: `ramsey-ui-web/.gitignore`**

```
node_modules/
target/
dist/
```

- [ ] **Step 8: `ramsey-ui-web/pom.xml`** — frontend-maven-plugin installs Node, runs `npm ci` then `npm run build`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>com.setminusx</groupId>
        <artifactId>ramsey-ui</artifactId>
        <version>0.1.0</version>
    </parent>
    <artifactId>ramsey-ui-web</artifactId>
    <packaging>jar</packaging>

    <build>
        <plugins>
            <plugin>
                <groupId>com.github.eirslett</groupId>
                <artifactId>frontend-maven-plugin</artifactId>
                <version>${frontend-maven-plugin.version}</version>
                <configuration>
                    <nodeVersion>${node.version}</nodeVersion>
                    <installDirectory>target</installDirectory>
                </configuration>
                <executions>
                    <execution>
                        <id>install-node-and-npm</id>
                        <goals><goal>install-node-and-npm</goal></goals>
                    </execution>
                    <execution>
                        <id>npm-ci</id>
                        <goals><goal>npm</goal></goals>
                        <configuration><arguments>ci</arguments></configuration>
                    </execution>
                    <execution>
                        <id>npm-build</id>
                        <goals><goal>npm</goal></goals>
                        <configuration><arguments>run build</arguments></configuration>
                    </execution>
                </executions>
            </plugin>
        </plugins>
    </build>
</project>
```

- [ ] **Step 9: Generate the npm lockfile** (frontend-maven-plugin uses `npm ci`, which requires `package-lock.json`)

Run: `cd ramsey-ui-web && npm install && cd ..`
Expected: creates `ramsey-ui-web/package-lock.json` and `node_modules/`.

- [ ] **Step 10: Build the module and verify the SPA lands in the jar**

Run: `mvn -q -pl ramsey-ui-web package`
Then: `unzip -l ramsey-ui-web/target/ramsey-ui-web-0.1.0.jar | grep 'META-INF/resources/index.html'`
Expected: the listing shows `META-INF/resources/index.html` (and `META-INF/resources/assets/...`).

- [ ] **Step 11: Commit**

```bash
git add pom.xml ramsey-ui-web
git commit -m "$(printf 'feat: scaffold parent pom and React (ramsey-ui-web) module\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_0169KJrUT5NQv2VBFWy9UuKt')"
```

---

## Task 2: Backend skeleton — Spring Boot app that serves the SPA

**Files:**
- Create: `ramsey-ui-rest/pom.xml`
- Create: `ramsey-ui-rest/src/main/java/com/setminusx/ramsey/ui/Application.java`
- Create: `ramsey-ui-rest/src/main/resources/application.yml`
- Test: `ramsey-ui-rest/src/test/java/com/setminusx/ramsey/ui/SpaServingTest.java`

**Interfaces:**
- Consumes: `ramsey-ui-web` jar (Task 1) on the classpath for static SPA assets.
- Produces: a bootable Spring Boot app on port 8080 serving `GET /` → the SPA, `GET /actuator/health` → `{"status":"UP"}`.

- [ ] **Step 1: `ramsey-ui-rest/pom.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>com.setminusx</groupId>
        <artifactId>ramsey-ui</artifactId>
        <version>0.1.0</version>
    </parent>
    <artifactId>ramsey-ui-rest</artifactId>
    <packaging>jar</packaging>

    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-websocket</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-redis</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-actuator</artifactId>
        </dependency>
        <!-- bundles the built SPA (META-INF/resources) into this app's classpath -->
        <dependency>
            <groupId>com.setminusx</groupId>
            <artifactId>ramsey-ui-web</artifactId>
            <version>0.1.0</version>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <configuration>
                    <release>25</release>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
```

- [ ] **Step 2: `Application.java`**

```java
package com.setminusx.ramsey.ui;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

- [ ] **Step 3: `application.yml`**

```yaml
server:
  port: 8080
spring:
  application:
    name: ramsey-ui-rest
  data:
    redis:
      host: ${REDIS_HOST:localhost}
      port: ${REDIS_PORT:6379}
management:
  endpoints:
    web:
      exposure:
        include: health,info
ramsey:
  api-base-url: ${API_BASE_URL:http://localhost:36000}
  sampler:
    interval-ms: 1000
  throughput:
    buffer-capacity: 7200
    default-window-seconds: 7200
```

- [ ] **Step 4: Write the failing SPA-serving test**

`SpaServingTest.java`:
```java
package com.setminusx.ramsey.ui;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.ResponseEntity;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SpaServingTest {

    @LocalServerPort int port;
    @Autowired RestTemplateBuilder builder;

    @Test
    void serves_index_html_at_root() {
        ResponseEntity<String> resp = builder.build()
                .getForEntity("http://localhost:" + port + "/", String.class);
        assertThat(resp.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(resp.getBody()).contains("<div id=\"root\">");
    }

    @Test
    void health_is_up() {
        ResponseEntity<String> resp = builder.build()
                .getForEntity("http://localhost:" + port + "/actuator/health", String.class);
        assertThat(resp.getBody()).contains("\"status\":\"UP\"");
    }
}
```

- [ ] **Step 5: Run the test, expect FAIL**

Run: `mvn -q -pl ramsey-ui-rest test -Dtest=SpaServingTest`
Expected: FAIL — the app needs Redis auto-config to start. Because no Redis is running in CI, the context still starts (Spring Data Redis is lazy and does not connect at startup), so the likely real failure is the SPA assertion if the web jar dependency or `index.html` is missing. If it fails on Redis connection, that confirms the next step is needed.

- [ ] **Step 6: Make it pass — ensure the reactor builds web before rest**

The `<dependency>` on `ramsey-ui-web` already forces reactor ordering. Build the whole project so the web jar exists:

Run: `mvn -q -DskipTests package && mvn -q -pl ramsey-ui-rest test -Dtest=SpaServingTest`
Expected: PASS (both tests green). Spring Data Redis does not open a connection at startup, so the context boots without a running Redis.

- [ ] **Step 7: Commit**

```bash
git add ramsey-ui-rest
git commit -m "$(printf 'feat: Spring Boot backend serves the React SPA\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_0169KJrUT5NQv2VBFWy9UuKt')"
```

---

## Task 3: Redis live-stage service + DTOs

**Files:**
- Create: `ramsey-ui-rest/.../model/ThroughputSample.java`, `BestResultDto.java`, `LiveStageDto.java`, `CampaignDto.java`, `ProgressionPointDto.java` (the records from Shared Contract)
- Create: `ramsey-ui-rest/.../redis/StageKeys.java`
- Create: `ramsey-ui-rest/.../redis/StageCounterReader.java` (interface)
- Create: `ramsey-ui-rest/.../redis/RedisLiveStageService.java`
- Test: `ramsey-ui-rest/.../redis/RedisLiveStageServiceTest.java`

**Interfaces:**
- Produces:
  - `StageKeys.PROCESSED_COUNT` = `"processed_count:"`, `WORK_INDEX` = `"stage_work_index:"`, `STAGE_CONFIG` = `"stage_config:"`, `BEST_RESULTS` = `"best_results:"`.
  - `interface StageCounterReader { long readProcessedCount(int stageId); }`
  - `RedisLiveStageService implements StageCounterReader` with `long getProcessedCount(int)`, `long getWorkIndex(int)`, `long getTotalPairs(int)`, `List<BestResultDto> getBestResults(int)`, `LiveStageDto getLiveStage(int)`.

- [ ] **Step 1: Create the five model records** (copy from Shared Contract verbatim into `com.setminusx.ramsey.ui.model`).

- [ ] **Step 2: `StageKeys.java`**

```java
package com.setminusx.ramsey.ui.redis;

public final class StageKeys {
    private StageKeys() {}
    // Throughput source. Fallback per spec: change to "stage_work_index:".
    public static final String PROCESSED_COUNT = "processed_count:";
    public static final String WORK_INDEX = "stage_work_index:";
    public static final String STAGE_CONFIG = "stage_config:";
    public static final String BEST_RESULTS = "best_results:";
}
```

- [ ] **Step 3: `StageCounterReader.java`**

```java
package com.setminusx.ramsey.ui.redis;

public interface StageCounterReader {
    long readProcessedCount(int stageId);
}
```

- [ ] **Step 4: Write the failing test** (mocked Redis template; covers totalPairs parse + best-results parse incl. the vertex-0 edge)

`RedisLiveStageServiceTest.java`:
```java
package com.setminusx.ramsey.ui.redis;

import com.setminusx.ramsey.ui.model.BestResultDto;
import com.setminusx.ramsey.ui.model.LiveStageDto;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.ZSetOperations;
import tools.jackson.databind.ObjectMapper;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class RedisLiveStageServiceTest {

    private ZSetOperations.TypedTuple<String> tuple(String member, double score) {
        return new org.springframework.data.redis.core.DefaultTypedTuple<>(member, score);
    }

    @Test
    void parses_counts_progress_and_best_results_including_vertex_zero() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked") ValueOperations<String, String> val = mock(ValueOperations.class);
        @SuppressWarnings("unchecked") ZSetOperations<String, String> zset = mock(ZSetOperations.class);
        when(redis.opsForValue()).thenReturn(val);
        when(redis.opsForZSet()).thenReturn(zset);
        when(val.get("processed_count:5")).thenReturn("1500");
        when(val.get("stage_work_index:5")).thenReturn("300");
        when(val.get("stage_config:5")).thenReturn("{\"totalPairs\":600}");

        Set<ZSetOperations.TypedTuple<String>> results = new LinkedHashSet<>();
        results.add(tuple("{\"edgesToFlip\":[{\"vertexOne\":0,\"vertexTwo\":7}]}", 775000));
        results.add(tuple("{\"graphBitstring\":\"0101\"}", 775100));
        when(zset.rangeWithScores("best_results:5", 0, -1)).thenReturn(results);

        RedisLiveStageService svc = new RedisLiveStageService(redis, new ObjectMapper());
        LiveStageDto dto = svc.getLiveStage(5);

        assertThat(dto.processedCount()).isEqualTo(1500);
        assertThat(dto.workIndex()).isEqualTo(300);
        assertThat(dto.totalPairs()).isEqualTo(600);
        assertThat(dto.progressPct()).isEqualTo(50.0);

        List<BestResultDto> best = dto.bestResults();
        assertThat(best).hasSize(2);
        assertThat(best.get(0).cliqueCount()).isEqualTo(775000);
        assertThat(best.get(0).edges()).containsExactly(List.of(0, 7)); // vertex-0 not dropped
        assertThat(best.get(0).fullGraph()).isFalse();
        assertThat(best.get(1).edges()).isEmpty();
        assertThat(best.get(1).fullGraph()).isTrue();
    }

    @Test
    void missing_keys_default_to_zero() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked") ValueOperations<String, String> val = mock(ValueOperations.class);
        @SuppressWarnings("unchecked") ZSetOperations<String, String> zset = mock(ZSetOperations.class);
        when(redis.opsForValue()).thenReturn(val);
        when(redis.opsForZSet()).thenReturn(zset);
        when(zset.rangeWithScores(anyString(), anyLong(), anyLong())).thenReturn(new LinkedHashSet<>());

        RedisLiveStageService svc = new RedisLiveStageService(redis, new ObjectMapper());
        LiveStageDto dto = svc.getLiveStage(9);

        assertThat(dto.processedCount()).isZero();
        assertThat(dto.totalPairs()).isZero();
        assertThat(dto.progressPct()).isZero();
        assertThat(dto.bestResults()).isEmpty();
    }
}
```

- [ ] **Step 5: Run, expect FAIL**

Run: `mvn -q -pl ramsey-ui-rest test -Dtest=RedisLiveStageServiceTest`
Expected: FAIL — `RedisLiveStageService` does not exist.

- [ ] **Step 6: Implement `RedisLiveStageService.java`**

```java
package com.setminusx.ramsey.ui.redis;

import com.setminusx.ramsey.ui.model.BestResultDto;
import com.setminusx.ramsey.ui.model.LiveStageDto;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

@Service
public class RedisLiveStageService implements StageCounterReader {

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    public RedisLiveStageService(StringRedisTemplate redis, ObjectMapper objectMapper) {
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    @Override
    public long readProcessedCount(int stageId) {
        return getProcessedCount(stageId);
    }

    public long getProcessedCount(int stageId) {
        return parseLong(redis.opsForValue().get(StageKeys.PROCESSED_COUNT + stageId));
    }

    public long getWorkIndex(int stageId) {
        return parseLong(redis.opsForValue().get(StageKeys.WORK_INDEX + stageId));
    }

    public long getTotalPairs(int stageId) {
        String json = redis.opsForValue().get(StageKeys.STAGE_CONFIG + stageId);
        if (json == null || json.isBlank()) return 0L;
        try {
            JsonNode node = objectMapper.readTree(json);
            JsonNode tp = node.get("totalPairs");
            return tp != null ? tp.asLong() : 0L;
        } catch (Exception e) {
            return 0L;
        }
    }

    public List<BestResultDto> getBestResults(int stageId) {
        Set<ZSetOperations.TypedTuple<String>> tuples =
                redis.opsForZSet().rangeWithScores(StageKeys.BEST_RESULTS + stageId, 0, -1);
        List<BestResultDto> out = new ArrayList<>();
        if (tuples == null) return out;
        for (ZSetOperations.TypedTuple<String> t : tuples) {
            String member = t.getValue();
            Double score = t.getScore();
            if (member == null || score == null) continue;
            try {
                out.add(parseBestResult(member, score.longValue()));
            } catch (Exception ignored) {
                // skip malformed members
            }
        }
        return out;
    }

    public LiveStageDto getLiveStage(int stageId) {
        long processed = getProcessedCount(stageId);
        long workIndex = getWorkIndex(stageId);
        long totalPairs = getTotalPairs(stageId);
        double pct = totalPairs > 0 ? Math.min(100.0, (workIndex * 100.0) / totalPairs) : 0.0;
        return new LiveStageDto(stageId, processed, workIndex, totalPairs, pct, getBestResults(stageId));
    }

    private BestResultDto parseBestResult(String member, long cliqueCount) {
        JsonNode node = objectMapper.readTree(member);
        List<List<Integer>> edges = new ArrayList<>();
        JsonNode etf = node.get("edgesToFlip");
        if (etf != null && etf.isArray()) {
            for (JsonNode e : etf) {
                Integer u = intOrNull(e, "vertexOne", "vertex_one");
                Integer v = intOrNull(e, "vertexTwo", "vertex_two");
                if (u != null && v != null) edges.add(List.of(u, v)); // 0 is valid
            }
        }
        boolean fullGraph = edges.isEmpty() && node.hasNonNull("graphBitstring");
        return new BestResultDto(cliqueCount, edges, fullGraph);
    }

    private static Integer intOrNull(JsonNode e, String camel, String snake) {
        JsonNode n = e.get(camel);
        if (n == null) n = e.get(snake);
        return (n != null && n.isIntegralNumber()) ? n.asInt() : null;
    }

    private static long parseLong(String s) {
        if (s == null || s.isBlank()) return 0L;
        try { return Long.parseLong(s.trim()); } catch (NumberFormatException e) { return 0L; }
    }
}
```

- [ ] **Step 7: Run, expect PASS**

Run: `mvn -q -pl ramsey-ui-rest test -Dtest=RedisLiveStageServiceTest`
Expected: PASS (both tests).

- [ ] **Step 8: Commit**

```bash
git add ramsey-ui-rest/src/main/java/com/setminusx/ramsey/ui/model ramsey-ui-rest/src/main/java/com/setminusx/ramsey/ui/redis ramsey-ui-rest/src/test/java/com/setminusx/ramsey/ui/redis
git commit -m "$(printf 'feat: Redis live-stage service + dashboard DTOs\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_0169KJrUT5NQv2VBFWy9UuKt')"
```

---

## Task 4: ramsey-mw REST client (campaigns + progression)

**Files:**
- Create: `ramsey-ui-rest/.../config/RamseyProperties.java`
- Create: `ramsey-ui-rest/.../config/RestClientConfig.java`
- Create: `ramsey-ui-rest/.../client/MwClient.java`
- Test: `ramsey-ui-rest/.../client/MwClientTest.java`

**Interfaces:**
- Consumes: `CampaignDto`, `ProgressionPointDto` (Task 3 / Shared Contract).
- Produces: `MwClient` with `List<CampaignDto> getCampaigns()` and `List<ProgressionPointDto> getProgression(int campaignId)`; `RamseyProperties` exposing `apiBaseUrl()`, `sampler().intervalMs()`, `throughput().bufferCapacity()`, `throughput().defaultWindowSeconds()`.

- [ ] **Step 1: `RamseyProperties.java`**

```java
package com.setminusx.ramsey.ui.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "ramsey")
public record RamseyProperties(String apiBaseUrl, Sampler sampler, Throughput throughput) {
    public record Sampler(long intervalMs) {}
    public record Throughput(int bufferCapacity, int defaultWindowSeconds) {}
}
```

- [ ] **Step 2: `RestClientConfig.java`** — enable the properties and expose a `RestClient.Builder`.

```java
package com.setminusx.ramsey.ui.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

@Configuration
@EnableConfigurationProperties(RamseyProperties.class)
public class RestClientConfig {
    @Bean
    RestClient.Builder restClientBuilder() {
        return RestClient.builder();
    }
}
```

- [ ] **Step 3: Write the failing test** (MockRestServiceServer bound to the builder)

`MwClientTest.java`:
```java
package com.setminusx.ramsey.ui.client;

import com.setminusx.ramsey.ui.config.RamseyProperties;
import com.setminusx.ramsey.ui.model.CampaignDto;
import com.setminusx.ramsey.ui.model.ProgressionPointDto;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;
import static org.springframework.http.MediaType.APPLICATION_JSON;

class MwClientTest {

    private MwClient build(MockRestServiceServer[] holder) {
        RestClient.Builder builder = RestClient.builder();
        holder[0] = MockRestServiceServer.bindTo(builder).build();
        RamseyProperties props = new RamseyProperties(
                "http://mw:8080",
                new RamseyProperties.Sampler(1000),
                new RamseyProperties.Throughput(7200, 7200));
        return new MwClient(builder, props);
    }

    @Test
    void maps_campaigns() {
        MockRestServiceServer[] holder = new MockRestServiceServer[1];
        MwClient client = build(holder);
        holder[0].expect(requestTo("http://mw:8080/api/ramsey/campaigns"))
                .andRespond(withSuccess("""
                    [{"campaignId":10,"subgraphSize":8,"vertexCount":281,"totalPairs":600,
                      "strategy":"COMPREHENSIVE_EDGE_PAIR_MUTATION","status":"ACTIVE",
                      "createdDate":"2026-06-14T10:00:00","updatedDate":"2026-06-16T12:00:00"}]
                    """, APPLICATION_JSON));

        List<CampaignDto> campaigns = client.getCampaigns();
        assertThat(campaigns).hasSize(1);
        assertThat(campaigns.get(0).campaignId()).isEqualTo(10);
        assertThat(campaigns.get(0).status()).isEqualTo("ACTIVE");
        holder[0].verify();
    }

    @Test
    void maps_progression() {
        MockRestServiceServer[] holder = new MockRestServiceServer[1];
        MwClient client = build(holder);
        holder[0].expect(requestTo("http://mw:8080/api/ramsey/campaigns/10/progression"))
                .andRespond(withSuccess("""
                    [{"stageId":42,"graphId":8348,"cliqueCount":775623,"status":"ACTIVE",
                      "createdDate":"2026-06-16T12:00:00"}]
                    """, APPLICATION_JSON));

        List<ProgressionPointDto> prog = client.getProgression(10);
        assertThat(prog).hasSize(1);
        assertThat(prog.get(0).stageId()).isEqualTo(42);
        assertThat(prog.get(0).cliqueCount()).isEqualTo(775623);
        assertThat(prog.get(0).status()).isEqualTo("ACTIVE");
        holder[0].verify();
    }
}
```

- [ ] **Step 4: Run, expect FAIL**

Run: `mvn -q -pl ramsey-ui-rest test -Dtest=MwClientTest`
Expected: FAIL — `MwClient` does not exist.

- [ ] **Step 5: Implement `MwClient.java`**

```java
package com.setminusx.ramsey.ui.client;

import com.setminusx.ramsey.ui.config.RamseyProperties;
import com.setminusx.ramsey.ui.model.CampaignDto;
import com.setminusx.ramsey.ui.model.ProgressionPointDto;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.List;

@Component
public class MwClient {

    private final RestClient restClient;

    public MwClient(RestClient.Builder builder, RamseyProperties props) {
        this.restClient = builder.baseUrl(props.apiBaseUrl()).build();
    }

    public List<CampaignDto> getCampaigns() {
        List<CampaignDto> body = restClient.get()
                .uri("/api/ramsey/campaigns")
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
        return body != null ? body : List.of();
    }

    public List<ProgressionPointDto> getProgression(int campaignId) {
        List<ProgressionPointDto> body = restClient.get()
                .uri("/api/ramsey/campaigns/{id}/progression", campaignId)
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
        return body != null ? body : List.of();
    }
}
```

- [ ] **Step 6: Run, expect PASS**

Run: `mvn -q -pl ramsey-ui-rest test -Dtest=MwClientTest`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add ramsey-ui-rest/src/main/java/com/setminusx/ramsey/ui/config ramsey-ui-rest/src/main/java/com/setminusx/ramsey/ui/client ramsey-ui-rest/src/test/java/com/setminusx/ramsey/ui/client
git commit -m "$(printf 'feat: ramsey-mw REST client for campaigns and progression\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_0169KJrUT5NQv2VBFWy9UuKt')"
```

---

## Task 5: Active-stage resolver (cached)

**Files:**
- Create: `ramsey-ui-rest/.../sampler/ActiveStageResolver.java`
- Test: `ramsey-ui-rest/.../sampler/ActiveStageResolverTest.java`

**Interfaces:**
- Consumes: `MwClient` (Task 4).
- Produces: `ActiveStageResolver` with `Integer resolveActiveStageId()` — the stageId of the ACTIVE stage of the ACTIVE campaign, or `null`. Result cached for ~5s using the injected `Clock`.

- [ ] **Step 1: Write the failing test**

`ActiveStageResolverTest.java`:
```java
package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.client.MwClient;
import com.setminusx.ramsey.ui.model.CampaignDto;
import com.setminusx.ramsey.ui.model.ProgressionPointDto;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class ActiveStageResolverTest {

    private CampaignDto campaign(int id, String status) {
        return new CampaignDto(id, 8, 281, 600L, "S", status, "2026-06-14T10:00:00", "2026-06-16T12:00:00");
    }
    private ProgressionPointDto stage(int id, String status) {
        return new ProgressionPointDto(id, 1, 100L, status, "2026-06-16T12:00:00");
    }

    @Test
    void resolves_active_stage_of_active_campaign() {
        MwClient mw = mock(MwClient.class);
        when(mw.getCampaigns()).thenReturn(List.of(campaign(1, "INACTIVE"), campaign(10, "ACTIVE")));
        when(mw.getProgression(10)).thenReturn(List.of(stage(40, "COMPLETE"), stage(42, "ACTIVE")));

        ActiveStageResolver resolver = new ActiveStageResolver(mw, Clock.systemUTC());
        assertThat(resolver.resolveActiveStageId()).isEqualTo(42);
    }

    @Test
    void returns_null_when_no_active_campaign() {
        MwClient mw = mock(MwClient.class);
        when(mw.getCampaigns()).thenReturn(List.of(campaign(1, "INACTIVE")));
        ActiveStageResolver resolver = new ActiveStageResolver(mw, Clock.systemUTC());
        assertThat(resolver.resolveActiveStageId()).isNull();
    }

    @Test
    void caches_within_window_then_refreshes() {
        MwClient mw = mock(MwClient.class);
        when(mw.getCampaigns()).thenReturn(List.of(campaign(10, "ACTIVE")));
        when(mw.getProgression(10)).thenReturn(List.of(stage(42, "ACTIVE")));

        MutableClock clock = new MutableClock(Instant.parse("2026-06-20T00:00:00Z"));
        ActiveStageResolver resolver = new ActiveStageResolver(mw, clock);

        resolver.resolveActiveStageId();
        resolver.resolveActiveStageId();
        verify(mw, times(1)).getCampaigns(); // cached, only one call

        clock.advanceSeconds(6);
        resolver.resolveActiveStageId();
        verify(mw, times(2)).getCampaigns(); // cache expired, refreshed
    }

    // Minimal adjustable clock for cache tests.
    static class MutableClock extends Clock {
        private Instant now;
        MutableClock(Instant start) { this.now = start; }
        void advanceSeconds(long s) { now = now.plusSeconds(s); }
        @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId z) { return this; }
        @Override public Instant instant() { return now; }
    }
}
```

- [ ] **Step 2: Run, expect FAIL**

Run: `mvn -q -pl ramsey-ui-rest test -Dtest=ActiveStageResolverTest`
Expected: FAIL — `ActiveStageResolver` does not exist.

- [ ] **Step 3: Implement `ActiveStageResolver.java`**

```java
package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.client.MwClient;
import com.setminusx.ramsey.ui.model.CampaignDto;
import com.setminusx.ramsey.ui.model.ProgressionPointDto;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.util.List;

@Component
public class ActiveStageResolver {

    private static final long CACHE_MILLIS = 5000;

    private final MwClient mw;
    private final Clock clock;

    private Integer cachedStageId;
    private long cachedAtMillis;
    private boolean cached; // gate the freshness check so the first call always computes
                            // (avoids Long.MIN_VALUE sentinel overflow in now - cachedAtMillis)

    public ActiveStageResolver(MwClient mw, Clock clock) {
        this.mw = mw;
        this.clock = clock;
    }

    public synchronized Integer resolveActiveStageId() {
        long now = clock.millis();
        if (cached && now - cachedAtMillis < CACHE_MILLIS) {
            return cachedStageId;
        }
        try {
            cachedStageId = computeActiveStageId();
        } catch (Exception e) {
            cachedStageId = null; // mw unreachable -> no active stage; sampler emits 0
        }
        cachedAtMillis = now;
        cached = true;
        return cachedStageId;
    }

    private Integer computeActiveStageId() {
        CampaignDto active = mw.getCampaigns().stream()
                .filter(c -> "ACTIVE".equalsIgnoreCase(c.status()))
                .findFirst()
                .orElse(null);
        if (active == null) return null;

        List<ProgressionPointDto> prog = mw.getProgression(active.campaignId());
        return prog.stream()
                .filter(p -> "ACTIVE".equalsIgnoreCase(p.status()))
                .map(ProgressionPointDto::stageId)
                .findFirst()
                .orElse(null);
    }
}
```

- [ ] **Step 4: Add a `Clock` bean** so the resolver/sampler get a real clock in production. Add to `RestClientConfig.java`:

```java
    @Bean
    java.time.Clock clock() {
        return java.time.Clock.systemUTC();
    }
```

- [ ] **Step 5: Run, expect PASS**

Run: `mvn -q -pl ramsey-ui-rest test -Dtest=ActiveStageResolverTest`
Expected: PASS (all three).

- [ ] **Step 6: Commit**

```bash
git add ramsey-ui-rest/src/main/java/com/setminusx/ramsey/ui/sampler/ActiveStageResolver.java ramsey-ui-rest/src/main/java/com/setminusx/ramsey/ui/config/RestClientConfig.java ramsey-ui-rest/src/test/java/com/setminusx/ramsey/ui/sampler/ActiveStageResolverTest.java
git commit -m "$(printf 'feat: cached active-stage resolver\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_0169KJrUT5NQv2VBFWy9UuKt')"
```

---

## Task 6: Throughput ring buffer

**Files:**
- Create: `ramsey-ui-rest/.../sampler/ThroughputBuffer.java`
- Create: `ramsey-ui-rest/.../config/ThroughputConfig.java`
- Test: `ramsey-ui-rest/.../sampler/ThroughputBufferTest.java`

**Interfaces:**
- Consumes: `ThroughputSample` (Task 3).
- Produces: `ThroughputBuffer` with `void add(ThroughputSample)`, `List<ThroughputSample> snapshotSince(long sinceTsMillis)`, `List<ThroughputSample> snapshot()`; capacity-bounded (oldest evicted). Exposed as a Spring bean sized from `ramsey.throughput.buffer-capacity`.

- [ ] **Step 1: Write the failing test**

`ThroughputBufferTest.java`:
```java
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
```

- [ ] **Step 2: Run, expect FAIL**

Run: `mvn -q -pl ramsey-ui-rest test -Dtest=ThroughputBufferTest`
Expected: FAIL — `ThroughputBuffer` does not exist.

- [ ] **Step 3: Implement `ThroughputBuffer.java`**

```java
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
```

- [ ] **Step 4: `ThroughputConfig.java`** — register the buffer bean.

```java
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
```

- [ ] **Step 5: Run, expect PASS**

Run: `mvn -q -pl ramsey-ui-rest test -Dtest=ThroughputBufferTest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ramsey-ui-rest/src/main/java/com/setminusx/ramsey/ui/sampler/ThroughputBuffer.java ramsey-ui-rest/src/main/java/com/setminusx/ramsey/ui/config/ThroughputConfig.java ramsey-ui-rest/src/test/java/com/setminusx/ramsey/ui/sampler/ThroughputBufferTest.java
git commit -m "$(printf 'feat: in-memory throughput ring buffer\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_0169KJrUT5NQv2VBFWy9UuKt')"
```

---

## Task 7: Throughput sampler + WebSocket broadcaster

**Files:**
- Create: `ramsey-ui-rest/.../sampler/ThroughputBroadcaster.java`
- Create: `ramsey-ui-rest/.../config/WebSocketConfig.java`
- Create: `ramsey-ui-rest/.../sampler/ThroughputSampler.java`
- Test: `ramsey-ui-rest/.../sampler/ThroughputSamplerTest.java`

**Interfaces:**
- Consumes: `ActiveStageResolver` (Task 5), `StageCounterReader` (Task 3), `ThroughputBuffer` (Task 6), `Clock` (Task 5).
- Produces:
  - `interface ThroughputBroadcaster { void broadcast(ThroughputSample s); }` + a STOMP impl sending to `/topic/throughput`.
  - `ThroughputSampler` with `@Scheduled` `void sample()` implementing: null-stage→`0`; first/changed stage→re-baseline+`0`; else `(count-last)/elapsedSec` clamped at 0.

- [ ] **Step 1: `ThroughputBroadcaster.java`** (interface + STOMP impl)

```java
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
```

- [ ] **Step 2: `WebSocketConfig.java`**

```java
package com.setminusx.ramsey.ui.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws").setAllowedOriginPatterns("*");
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic");
        registry.setApplicationDestinationPrefixes("/app");
    }
}
```

- [ ] **Step 3: Write the failing sampler test** (real buffer, mocked collaborators, mutable clock)

`ThroughputSamplerTest.java`:
```java
package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.model.ThroughputSample;
import com.setminusx.ramsey.ui.redis.StageCounterReader;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class ThroughputSamplerTest {

    static class MutableClock extends Clock {
        private Instant now;
        MutableClock(Instant start) { this.now = start; }
        void advanceMillis(long ms) { now = now.plusMillis(ms); }
        @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId z) { return this; }
        @Override public Instant instant() { return now; }
    }

    private ThroughputSample lastBroadcast(ThroughputBroadcaster b) {
        ArgumentCaptor<ThroughputSample> cap = ArgumentCaptor.forClass(ThroughputSample.class);
        verify(b, atLeastOnce()).broadcast(cap.capture());
        return cap.getValue();
    }

    @Test
    void emits_zero_when_no_active_stage() {
        ActiveStageResolver resolver = mock(ActiveStageResolver.class);
        StageCounterReader reader = mock(StageCounterReader.class);
        ThroughputBroadcaster broadcaster = mock(ThroughputBroadcaster.class);
        ThroughputBuffer buffer = new ThroughputBuffer(100);
        when(resolver.resolveActiveStageId()).thenReturn(null);

        ThroughputSampler sampler = new ThroughputSampler(resolver, reader, buffer, broadcaster,
                new MutableClock(Instant.parse("2026-06-20T00:00:00Z")));
        sampler.sample();

        assertThat(lastBroadcast(broadcaster).unitsPerSec()).isZero();
        assertThat(lastBroadcast(broadcaster).stageId()).isNull();
    }

    @Test
    void first_sample_baselines_at_zero_then_computes_rate() {
        ActiveStageResolver resolver = mock(ActiveStageResolver.class);
        StageCounterReader reader = mock(StageCounterReader.class);
        ThroughputBroadcaster broadcaster = mock(ThroughputBroadcaster.class);
        ThroughputBuffer buffer = new ThroughputBuffer(100);
        MutableClock clock = new MutableClock(Instant.parse("2026-06-20T00:00:00Z"));
        when(resolver.resolveActiveStageId()).thenReturn(42);

        ThroughputSampler sampler = new ThroughputSampler(resolver, reader, buffer, broadcaster, clock);

        when(reader.readProcessedCount(42)).thenReturn(1000L);
        sampler.sample(); // baseline, expect 0

        clock.advanceMillis(1000);
        when(reader.readProcessedCount(42)).thenReturn(1100L);
        sampler.sample(); // +100 over 1s => 100/s

        assertThat(buffer.snapshot()).extracting(ThroughputSample::unitsPerSec)
                .containsExactly(0.0, 100.0);
    }

    @Test
    void clamps_negative_rate_on_counter_reset() {
        ActiveStageResolver resolver = mock(ActiveStageResolver.class);
        StageCounterReader reader = mock(StageCounterReader.class);
        ThroughputBroadcaster broadcaster = mock(ThroughputBroadcaster.class);
        ThroughputBuffer buffer = new ThroughputBuffer(100);
        MutableClock clock = new MutableClock(Instant.parse("2026-06-20T00:00:00Z"));
        when(resolver.resolveActiveStageId()).thenReturn(42);

        ThroughputSampler sampler = new ThroughputSampler(resolver, reader, buffer, broadcaster, clock);
        when(reader.readProcessedCount(42)).thenReturn(5000L);
        sampler.sample();
        clock.advanceMillis(1000);
        when(reader.readProcessedCount(42)).thenReturn(10L); // reset
        sampler.sample();

        assertThat(buffer.snapshot()).extracting(ThroughputSample::unitsPerSec)
                .containsExactly(0.0, 0.0);
    }

    @Test
    void rebaselines_without_spike_on_stage_change() {
        ActiveStageResolver resolver = mock(ActiveStageResolver.class);
        StageCounterReader reader = mock(StageCounterReader.class);
        ThroughputBroadcaster broadcaster = mock(ThroughputBroadcaster.class);
        ThroughputBuffer buffer = new ThroughputBuffer(100);
        MutableClock clock = new MutableClock(Instant.parse("2026-06-20T00:00:00Z"));

        ThroughputSampler sampler = new ThroughputSampler(resolver, reader, buffer, broadcaster, clock);

        when(resolver.resolveActiveStageId()).thenReturn(42);
        when(reader.readProcessedCount(42)).thenReturn(1000L);
        sampler.sample(); // baseline stage 42

        clock.advanceMillis(1000);
        when(resolver.resolveActiveStageId()).thenReturn(43); // new stage
        when(reader.readProcessedCount(43)).thenReturn(50L);
        sampler.sample(); // re-baseline, expect 0 (no negative spike from 1000->50)

        assertThat(buffer.snapshot()).extracting(ThroughputSample::unitsPerSec)
                .containsExactly(0.0, 0.0);
        assertThat(buffer.snapshot().get(1).stageId()).isEqualTo(43);
    }
}
```

- [ ] **Step 4: Run, expect FAIL**

Run: `mvn -q -pl ramsey-ui-rest test -Dtest=ThroughputSamplerTest`
Expected: FAIL — `ThroughputSampler` does not exist.

- [ ] **Step 5: Implement `ThroughputSampler.java`**

```java
package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.model.ThroughputSample;
import com.setminusx.ramsey.ui.redis.StageCounterReader;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;

@Component
public class ThroughputSampler {

    private record Baseline(Integer stageId, long count, long ts) {}

    private final ActiveStageResolver resolver;
    private final StageCounterReader counterReader;
    private final ThroughputBuffer buffer;
    private final ThroughputBroadcaster broadcaster;
    private final Clock clock;

    private Baseline last;

    public ThroughputSampler(ActiveStageResolver resolver, StageCounterReader counterReader,
                             ThroughputBuffer buffer, ThroughputBroadcaster broadcaster, Clock clock) {
        this.resolver = resolver;
        this.counterReader = counterReader;
        this.buffer = buffer;
        this.broadcaster = broadcaster;
        this.clock = clock;
    }

    @Scheduled(fixedRateString = "${ramsey.sampler.interval-ms}")
    public void sample() {
        long now = clock.millis();
        Integer stageId = resolver.resolveActiveStageId();

        if (stageId == null) {
            last = null;
            emit(new ThroughputSample(now, null, 0.0));
            return;
        }

        long count = counterReader.readProcessedCount(stageId);

        if (last == null || !stageId.equals(last.stageId())) {
            last = new Baseline(stageId, count, now);
            emit(new ThroughputSample(now, stageId, 0.0));
            return;
        }

        double elapsedSec = (now - last.ts()) / 1000.0;
        double unitsPerSec = 0.0;
        if (elapsedSec > 0) {
            double delta = count - last.count();
            unitsPerSec = delta > 0 ? delta / elapsedSec : 0.0;
        }
        last = new Baseline(stageId, count, now);
        emit(new ThroughputSample(now, stageId, unitsPerSec));
    }

    private void emit(ThroughputSample sample) {
        buffer.add(sample);
        broadcaster.broadcast(sample);
    }
}
```

- [ ] **Step 6: Run, expect PASS**

Run: `mvn -q -pl ramsey-ui-rest test -Dtest=ThroughputSamplerTest`
Expected: PASS (all four).

- [ ] **Step 7: Commit**

```bash
git add ramsey-ui-rest/src/main/java/com/setminusx/ramsey/ui/sampler/ThroughputBroadcaster.java ramsey-ui-rest/src/main/java/com/setminusx/ramsey/ui/sampler/ThroughputSampler.java ramsey-ui-rest/src/main/java/com/setminusx/ramsey/ui/config/WebSocketConfig.java ramsey-ui-rest/src/test/java/com/setminusx/ramsey/ui/sampler/ThroughputSamplerTest.java
git commit -m "$(printf 'feat: throughput sampler + STOMP broadcaster\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_0169KJrUT5NQv2VBFWy9UuKt')"
```

---

## Task 8: REST controller + WebSocket integration test

**Files:**
- Create: `ramsey-ui-rest/.../web/DashboardController.java`
- Test: `ramsey-ui-rest/.../web/DashboardControllerTest.java`
- Test: `ramsey-ui-rest/.../sampler/ThroughputWebSocketIT.java`

**Interfaces:**
- Consumes: `MwClient`, `RedisLiveStageService`, `ThroughputBuffer`, `RamseyProperties`, `Clock`.
- Produces: the four `/api/dashboard/*` endpoints (Shared Contract) and verified `/topic/throughput` broadcast.

- [ ] **Step 1: Write the failing controller test** (`@WebMvcTest`, mocked services)

`DashboardControllerTest.java`:
```java
package com.setminusx.ramsey.ui.web;

import com.setminusx.ramsey.ui.client.MwClient;
import com.setminusx.ramsey.ui.config.RamseyProperties;
import com.setminusx.ramsey.ui.model.*;
import com.setminusx.ramsey.ui.redis.RedisLiveStageService;
import com.setminusx.ramsey.ui.sampler.ThroughputBuffer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(DashboardController.class)
class DashboardControllerTest {

    @Autowired MockMvc mvc;
    @MockitoBean MwClient mwClient;
    @MockitoBean RedisLiveStageService liveStageService;

    @TestConfiguration
    static class Beans {
        @Bean ThroughputBuffer throughputBuffer() {
            ThroughputBuffer b = new ThroughputBuffer(100);
            b.add(new ThroughputSample(1000, 42, 0.0));
            b.add(new ThroughputSample(2000, 42, 123.0));
            return b;
        }
        @Bean RamseyProperties ramseyProperties() {
            return new RamseyProperties("http://mw:8080",
                    new RamseyProperties.Sampler(1000), new RamseyProperties.Throughput(100, 7200));
        }
        @Bean Clock clock() {
            return Clock.fixed(Instant.ofEpochMilli(2000), ZoneOffset.UTC);
        }
    }

    @Test
    void campaigns_endpoint() throws Exception {
        when(mwClient.getCampaigns()).thenReturn(List.of(
                new CampaignDto(10, 8, 281, 600L, "S", "ACTIVE", "2026-06-14T10:00:00", "2026-06-16T12:00:00")));
        mvc.perform(get("/api/dashboard/campaigns"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].campaignId").value(10))
                .andExpect(jsonPath("$[0].status").value("ACTIVE"));
    }

    @Test
    void live_endpoint() throws Exception {
        when(liveStageService.getLiveStage(42)).thenReturn(
                new LiveStageDto(42, 1500, 300, 600, 50.0, List.of()));
        mvc.perform(get("/api/dashboard/stages/42/live"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.processedCount").value(1500))
                .andExpect(jsonPath("$.progressPct").value(50.0));
    }

    @Test
    void throughput_history_filters_by_window() throws Exception {
        // clock=2000ms, window=2s => since=0 => both points; window not given => default
        mvc.perform(get("/api/dashboard/throughput/history").param("window", "2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));
        mvc.perform(get("/api/dashboard/throughput/history").param("window", "0"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1)); // since=2000 => only ts>=2000
    }
}
```

- [ ] **Step 2: Run, expect FAIL**

Run: `mvn -q -pl ramsey-ui-rest test -Dtest=DashboardControllerTest`
Expected: FAIL — `DashboardController` does not exist.

- [ ] **Step 3: Implement `DashboardController.java`**

```java
package com.setminusx.ramsey.ui.web;

import com.setminusx.ramsey.ui.client.MwClient;
import com.setminusx.ramsey.ui.config.RamseyProperties;
import com.setminusx.ramsey.ui.model.*;
import com.setminusx.ramsey.ui.redis.RedisLiveStageService;
import com.setminusx.ramsey.ui.sampler.ThroughputBuffer;
import org.springframework.web.bind.annotation.*;

import java.time.Clock;
import java.util.List;

@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {

    private final MwClient mwClient;
    private final RedisLiveStageService liveStageService;
    private final ThroughputBuffer throughputBuffer;
    private final RamseyProperties props;
    private final Clock clock;

    public DashboardController(MwClient mwClient, RedisLiveStageService liveStageService,
                              ThroughputBuffer throughputBuffer, RamseyProperties props, Clock clock) {
        this.mwClient = mwClient;
        this.liveStageService = liveStageService;
        this.throughputBuffer = throughputBuffer;
        this.props = props;
        this.clock = clock;
    }

    @GetMapping("/campaigns")
    public List<CampaignDto> campaigns() {
        return mwClient.getCampaigns();
    }

    @GetMapping("/campaigns/{id}/progression")
    public List<ProgressionPointDto> progression(@PathVariable int id) {
        return mwClient.getProgression(id);
    }

    @GetMapping("/stages/{id}/live")
    public LiveStageDto live(@PathVariable int id) {
        return liveStageService.getLiveStage(id);
    }

    @GetMapping("/throughput/history")
    public List<ThroughputSample> history(@RequestParam(required = false) Integer window) {
        int windowSeconds = window != null ? window : props.throughput().defaultWindowSeconds();
        long since = clock.millis() - windowSeconds * 1000L;
        return throughputBuffer.snapshotSince(since);
    }
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `mvn -q -pl ramsey-ui-rest test -Dtest=DashboardControllerTest`
Expected: PASS (all three).

- [ ] **Step 5: Write the WebSocket integration test**

`ThroughputWebSocketIT.java`:
```java
package com.setminusx.ramsey.ui.sampler;

import com.setminusx.ramsey.ui.model.ThroughputSample;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.messaging.converter.MappingJackson2MessageConverter;
import org.springframework.messaging.simp.stomp.*;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;

import java.lang.reflect.Type;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ThroughputWebSocketIT {

    @LocalServerPort int port;
    @Autowired ThroughputBroadcaster broadcaster;

    @Test
    void client_receives_broadcast_sample() throws Exception {
        WebSocketStompClient stomp = new WebSocketStompClient(new StandardWebSocketClient());
        stomp.setMessageConverter(new MappingJackson2MessageConverter());

        CompletableFuture<ThroughputSample> received = new CompletableFuture<>();
        StompSession session = stomp.connectAsync("ws://localhost:" + port + "/ws",
                new StompSessionHandlerAdapter() {}).get(5, TimeUnit.SECONDS);

        session.subscribe("/topic/throughput", new StompFrameHandler() {
            @Override public Type getPayloadType(StompHeaders headers) { return ThroughputSample.class; }
            @Override public void handleFrame(StompHeaders headers, Object payload) {
                received.complete((ThroughputSample) payload);
            }
        });

        Thread.sleep(200); // allow subscription to register
        broadcaster.broadcast(new ThroughputSample(123L, 42, 999.0));

        ThroughputSample got = received.get(5, TimeUnit.SECONDS);
        assertThat(got.stageId()).isEqualTo(42);
        assertThat(got.unitsPerSec()).isEqualTo(999.0);
    }
}
```

Note: `MappingJackson2MessageConverter` is the STOMP-client test converter; the server-side broadcast serialization is Spring's default Jackson 3. Field names match, so round-trip works.

- [ ] **Step 6: Run the IT, expect PASS**

Run: `mvn -q -pl ramsey-ui-rest test -Dtest=ThroughputWebSocketIT`
Expected: PASS. (The `@Scheduled` sampler also runs every 1s during the test; it broadcasts `0`/null samples because no Redis/mw is up, which does not interfere — the test asserts on the explicit `999.0` sample it triggers.)

- [ ] **Step 7: Run the full backend test suite**

Run: `mvn -q -pl ramsey-ui-rest test`
Expected: PASS — all tasks 2–8 green.

- [ ] **Step 8: Commit**

```bash
git add ramsey-ui-rest/src/main/java/com/setminusx/ramsey/ui/web ramsey-ui-rest/src/test/java/com/setminusx/ramsey/ui/web ramsey-ui-rest/src/test/java/com/setminusx/ramsey/ui/sampler/ThroughputWebSocketIT.java
git commit -m "$(printf 'feat: dashboard REST endpoints + websocket broadcast IT\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_0169KJrUT5NQv2VBFWy9UuKt')"
```

---

## Task 9: Frontend data layer — types, API client, socket hook, bucketing (with tests)

**Files:**
- Create: `ramsey-ui-web/src/types.ts`
- Create: `ramsey-ui-web/src/api.ts`
- Create: `ramsey-ui-web/src/throughput.ts` (pure helpers: `bucketSamples`, `mergeSample`)
- Create: `ramsey-ui-web/src/useThroughputSocket.ts`
- Create: `ramsey-ui-web/src/test/setup.ts`
- Test: `ramsey-ui-web/src/throughput.test.ts`

**Interfaces:**
- Produces:
  - Types mirroring the backend records.
  - `api.getCampaigns()`, `api.getProgression(id)`, `api.getLiveStage(id)`, `api.getThroughputHistory(window)`.
  - `bucketSamples(samples: ThroughputSample[], bucketSeconds: number): Point[]` where `Point = { t: number; ups: number }`.
  - `mergeSample(prev: ThroughputSample[], s: ThroughputSample, maxPoints: number): ThroughputSample[]`.
  - `useThroughputSocket(): { samples: ThroughputSample[]; connected: boolean }`.

- [ ] **Step 1: `src/types.ts`**

```ts
export interface ThroughputSample { ts: number; stageId: number | null; unitsPerSec: number; }
export interface BestResultDto { cliqueCount: number; edges: number[][]; fullGraph: boolean; }
export interface LiveStageDto {
  stageId: number; processedCount: number; workIndex: number;
  totalPairs: number; progressPct: number; bestResults: BestResultDto[];
}
export interface CampaignDto {
  campaignId: number; subgraphSize: number; vertexCount: number; totalPairs: number | null;
  strategy: string; status: string; createdDate: string | null; updatedDate: string | null;
}
export interface ProgressionPointDto {
  stageId: number; graphId: number | null; cliqueCount: number;
  status: string; createdDate: string | null;
}
```

- [ ] **Step 2: `src/api.ts`**

```ts
import type { CampaignDto, ProgressionPointDto, LiveStageDto, ThroughputSample } from './types';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  getCampaigns: () => getJson<CampaignDto[]>('/api/dashboard/campaigns'),
  getProgression: (id: number) => getJson<ProgressionPointDto[]>(`/api/dashboard/campaigns/${id}/progression`),
  getLiveStage: (id: number) => getJson<LiveStageDto>(`/api/dashboard/stages/${id}/live`),
  getThroughputHistory: (windowSeconds: number) =>
    getJson<ThroughputSample[]>(`/api/dashboard/throughput/history?window=${windowSeconds}`),
};
```

- [ ] **Step 3: `src/test/setup.ts`**

```ts
import '@testing-library/jest-dom';
```

- [ ] **Step 4: Write the failing helper tests**

`src/throughput.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { bucketSamples, mergeSample } from './throughput';
import type { ThroughputSample } from './types';

const s = (ts: number, ups: number): ThroughputSample => ({ ts, stageId: 1, unitsPerSec: ups });

describe('bucketSamples', () => {
  it('passes 1s through unchanged', () => {
    const out = bucketSamples([s(1000, 10), s(2000, 20)], 1);
    expect(out).toEqual([{ t: 1000, ups: 10 }, { t: 2000, ups: 20 }]);
  });

  it('averages within a 5s bucket', () => {
    // 1000..5999 -> one 5s bucket keyed at 0; mean of 10,20,30
    const out = bucketSamples([s(1000, 10), s(2000, 20), s(3000, 30)], 5);
    expect(out).toHaveLength(1);
    expect(out[0].ups).toBe(20);
  });
});

describe('mergeSample', () => {
  it('appends and caps to maxPoints', () => {
    let arr: ThroughputSample[] = [s(1000, 1), s(2000, 2)];
    arr = mergeSample(arr, s(3000, 3), 2);
    expect(arr.map((x) => x.ts)).toEqual([2000, 3000]);
  });
});
```

- [ ] **Step 5: Run, expect FAIL**

Run: `cd ramsey-ui-web && npm test -- throughput && cd ..`
Expected: FAIL — `./throughput` module not found.

- [ ] **Step 6: Implement `src/throughput.ts`**

```ts
import type { ThroughputSample } from './types';

export interface Point { t: number; ups: number; }

export function bucketSamples(samples: ThroughputSample[], bucketSeconds: number): Point[] {
  if (bucketSeconds <= 1) {
    return samples.map((s) => ({ t: s.ts, ups: s.unitsPerSec }));
  }
  const sizeMs = bucketSeconds * 1000;
  const buckets = new Map<number, { sum: number; n: number }>();
  for (const s of samples) {
    const key = Math.floor(s.ts / sizeMs) * sizeMs;
    const b = buckets.get(key) ?? { sum: 0, n: 0 };
    b.sum += s.unitsPerSec;
    b.n += 1;
    buckets.set(key, b);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, b]) => ({ t, ups: b.sum / b.n }));
}

export function mergeSample(
  prev: ThroughputSample[], sample: ThroughputSample, maxPoints: number,
): ThroughputSample[] {
  const next = [...prev, sample];
  return next.length > maxPoints ? next.slice(next.length - maxPoints) : next;
}
```

- [ ] **Step 7: Implement `src/useThroughputSocket.ts`** (STOMP client; auto-reconnect; re-fetch history on (re)connect)

```ts
import { useEffect, useRef, useState } from 'react';
import { Client } from '@stomp/stompjs';
import type { ThroughputSample } from './types';
import { api } from './api';
import { mergeSample } from './throughput';

const MAX_POINTS = 7200;

export function useThroughputSocket() {
  const [samples, setSamples] = useState<ThroughputSample[]>([]);
  const [connected, setConnected] = useState(false);
  const clientRef = useRef<Client | null>(null);

  useEffect(() => {
    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const client = new Client({ brokerURL: wsUrl, reconnectDelay: 3000 });

    client.onConnect = () => {
      setConnected(true);
      api.getThroughputHistory(MAX_POINTS).then(setSamples).catch(() => undefined);
      client.subscribe('/topic/throughput', (msg) => {
        const sample = JSON.parse(msg.body) as ThroughputSample;
        setSamples((prev) => mergeSample(prev, sample, MAX_POINTS));
      });
    };
    client.onWebSocketClose = () => setConnected(false);

    client.activate();
    clientRef.current = client;
    return () => { client.deactivate(); };
  }, []);

  return { samples, connected };
}
```

- [ ] **Step 8: Run helper tests, expect PASS**

Run: `cd ramsey-ui-web && npm test -- throughput && cd ..`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add ramsey-ui-web/src/types.ts ramsey-ui-web/src/api.ts ramsey-ui-web/src/throughput.ts ramsey-ui-web/src/throughput.test.ts ramsey-ui-web/src/useThroughputSocket.ts ramsey-ui-web/src/test/setup.ts
git commit -m "$(printf 'feat: frontend data layer (types, api, socket, bucketing)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_0169KJrUT5NQv2VBFWy9UuKt')"
```

---

## Task 10: App shell, theme, sidebar (campaign selector + interval control), stat cards

> **Visual direction:** before writing the components, invoke the `frontend-design` skill and apply a modern dark dashboard aesthetic: dark slate background, restrained palette (green = improvement/healthy, red = regression, cyan/indigo accent for the live line), rounded cards with subtle borders, Inter font, `font-variant-numeric: tabular-nums` on all metrics so figures don't jitter. Layout = left sidebar + main column (stat-card row → throughput hero → historical charts → tables).

**Files:**
- Create: `ramsey-ui-web/src/theme.css`
- Create: `ramsey-ui-web/src/components/Sidebar.tsx`
- Create: `ramsey-ui-web/src/components/StatCards.tsx`
- Create: `ramsey-ui-web/src/components/Card.tsx`
- Modify: `ramsey-ui-web/src/App.tsx`, `ramsey-ui-web/src/main.tsx` (import `theme.css`)
- Test: `ramsey-ui-web/src/components/StatCards.test.tsx`

**Interfaces:**
- Consumes: `CampaignDto` (Task 9), `LiveStageDto`, `ProgressionPointDto`.
- Produces:
  - `<Card title>` wrapper.
  - `<Sidebar campaigns selectedId onSelect interval onIntervalChange lastUpdated>` where `interval: 1 | 5 | 30`.
  - `<StatCards current first liveStage unitsPerSec>` — renders metric cards; exported helper `sortCampaigns(campaigns): CampaignDto[]` (ACTIVE first, then most-recent updatedDate, then campaignId desc).

- [ ] **Step 1: Write the failing test** (campaign sort + stat formatting)

`src/components/StatCards.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCards, sortCampaigns } from './StatCards';
import type { CampaignDto, ProgressionPointDto, LiveStageDto } from '../types';

const camp = (id: number, status: string, updated: string): CampaignDto => ({
  campaignId: id, subgraphSize: 8, vertexCount: 281, totalPairs: 600,
  strategy: 'S', status, createdDate: updated, updatedDate: updated,
});

describe('sortCampaigns', () => {
  it('puts ACTIVE first, then newest updatedDate', () => {
    const out = sortCampaigns([
      camp(1, 'INACTIVE', '2026-06-10T00:00:00'),
      camp(2, 'INACTIVE', '2026-06-18T00:00:00'),
      camp(3, 'ACTIVE', '2026-06-01T00:00:00'),
    ]);
    expect(out.map((c) => c.campaignId)).toEqual([3, 2, 1]);
  });
});

describe('StatCards', () => {
  it('renders clique count and current throughput', () => {
    const first: ProgressionPointDto = { stageId: 1, graphId: 1, cliqueCount: 800000, status: 'COMPLETE', createdDate: null };
    const current: ProgressionPointDto = { stageId: 42, graphId: 2, cliqueCount: 775623, status: 'ACTIVE', createdDate: null };
    const live: LiveStageDto = { stageId: 42, processedCount: 1500, workIndex: 300, totalPairs: 600, progressPct: 50, bestResults: [] };
    render(<StatCards current={current} first={first} liveStage={live} unitsPerSec={123} />);
    expect(screen.getByText('775,623')).toBeInTheDocument();
    expect(screen.getByText(/123/)).toBeInTheDocument();
    expect(screen.getByText('50.0%')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd ramsey-ui-web && npm test -- StatCards && cd ..`
Expected: FAIL — `./StatCards` not found.

- [ ] **Step 3: Implement `src/components/Card.tsx`**

```tsx
import type { ReactNode } from 'react';

export function Card({ title, children, accent }: { title?: string; children: ReactNode; accent?: boolean }) {
  return (
    <section className={`card${accent ? ' card--accent' : ''}`}>
      {title && <h2 className="card__title">{title}</h2>}
      {children}
    </section>
  );
}
```

- [ ] **Step 4: Implement `src/components/StatCards.tsx`**

```tsx
import type { CampaignDto, ProgressionPointDto, LiveStageDto } from '../types';

export function sortCampaigns(campaigns: CampaignDto[]): CampaignDto[] {
  const ts = (c: CampaignDto) => (c.updatedDate ? Date.parse(c.updatedDate) : 0);
  return [...campaigns].sort((a, b) => {
    const aActive = a.status === 'ACTIVE' ? 0 : 1;
    const bActive = b.status === 'ACTIVE' ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    if (ts(a) !== ts(b)) return ts(b) - ts(a);
    return b.campaignId - a.campaignId;
  });
}

const fmt = (n: number) => n.toLocaleString('en-US');

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {sub && <div className="stat__sub">{sub}</div>}
    </div>
  );
}

export function StatCards({ current, first, liveStage, unitsPerSec }: {
  current: ProgressionPointDto; first: ProgressionPointDto;
  liveStage: LiveStageDto | null; unitsPerSec: number;
}) {
  const improvement = first.cliqueCount - current.cliqueCount;
  return (
    <div className="statcards">
      <Stat label="Active Stage" value={`#${current.stageId}`} />
      <Stat label="Clique Count" value={fmt(current.cliqueCount)}
            sub={`${improvement >= 0 ? '−' : '+'}${fmt(Math.abs(improvement))} from start`} />
      <Stat label="Total Improvement" value={fmt(improvement)} />
      <Stat label="Progress" value={liveStage ? `${liveStage.progressPct.toFixed(1)}%` : '—'}
            sub={liveStage ? `${fmt(Math.min(liveStage.workIndex, liveStage.totalPairs))} / ${fmt(liveStage.totalPairs)}` : undefined} />
      <Stat label="Throughput" value={`${fmt(Math.round(unitsPerSec))}/s`} />
    </div>
  );
}
```

- [ ] **Step 5: Implement `src/components/Sidebar.tsx`**

```tsx
import type { CampaignDto } from '../types';
import { sortCampaigns } from './StatCards';

export type Interval = 1 | 5 | 30;

export function Sidebar({ campaigns, selectedId, onSelect, interval, onIntervalChange, lastUpdated, connected }: {
  campaigns: CampaignDto[]; selectedId: number | null; onSelect: (id: number) => void;
  interval: Interval; onIntervalChange: (i: Interval) => void; lastUpdated: string; connected: boolean;
}) {
  const sorted = sortCampaigns(campaigns);
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">Ramsey<span>Progress</span></div>

      <label className="field">
        <span>Campaign</span>
        <select value={selectedId ?? ''} onChange={(e) => onSelect(Number(e.target.value))}>
          {sorted.map((c) => (
            <option key={c.campaignId} value={c.campaignId}>
              #{c.campaignId} — {c.vertexCount}v / k={c.subgraphSize} ({c.status})
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span>Live interval</span>
        <div className="segmented">
          {([1, 5, 30] as Interval[]).map((i) => (
            <button key={i} className={i === interval ? 'is-active' : ''}
                    onClick={() => onIntervalChange(i)}>{i}s</button>
          ))}
        </div>
      </div>

      <div className="sidebar__status">
        <span className={`dot ${connected ? 'dot--ok' : 'dot--off'}`} />
        {connected ? 'Live' : 'Reconnecting…'}
      </div>
      <div className="sidebar__updated">Updated {lastUpdated}</div>
    </aside>
  );
}
```

- [ ] **Step 6: `src/theme.css`** — dark dashboard theme (full file)

```css
:root {
  --bg: #0f172a; --panel: #1e293b; --panel-2: #243149; --border: #334155;
  --text: #e2e8f0; --muted: #94a3b8; --green: #34d399; --red: #f87171;
  --accent: #38bdf8; --accent-2: #818cf8;
  font-family: Inter, system-ui, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); }
.app { display: grid; grid-template-columns: 248px 1fr; min-height: 100vh; }
.sidebar { background: var(--panel); border-right: 1px solid var(--border); padding: 20px; display: flex; flex-direction: column; gap: 20px; }
.sidebar__brand { font-weight: 700; font-size: 20px; }
.sidebar__brand span { color: var(--accent); margin-left: 6px; font-weight: 500; }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--muted); }
.field select { background: var(--panel-2); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 8px; }
.segmented { display: flex; gap: 4px; }
.segmented button { flex: 1; background: var(--panel-2); color: var(--muted); border: 1px solid var(--border); border-radius: 8px; padding: 8px 0; cursor: pointer; }
.segmented button.is-active { background: var(--accent); color: #06283d; border-color: var(--accent); font-weight: 600; }
.sidebar__status { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-top: auto; }
.dot { width: 9px; height: 9px; border-radius: 50%; }
.dot--ok { background: var(--green); box-shadow: 0 0 8px var(--green); }
.dot--off { background: var(--red); }
.sidebar__updated { font-size: 12px; color: var(--muted); }
.main { padding: 24px 28px; display: flex; flex-direction: column; gap: 20px; }
.statcards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; }
.stat { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 16px; }
.stat__label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.stat__value { font-size: 26px; font-weight: 700; margin-top: 6px; font-variant-numeric: tabular-nums; }
.stat__sub { font-size: 12px; color: var(--muted); margin-top: 4px; font-variant-numeric: tabular-nums; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 18px; }
.card--accent { border-color: var(--accent); }
.card__title { font-size: 15px; margin: 0 0 12px; font-weight: 600; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; font-size: 14px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
th { color: var(--muted); font-weight: 500; }
```

- [ ] **Step 7: Wire `main.tsx` to import the theme**

In `src/main.tsx`, add as the first import: `import './theme.css';`

- [ ] **Step 8: Update `App.tsx` to render the shell** (data wiring filled in Task 12; for now render sidebar + stat cards from live data)

```tsx
import { useEffect, useState } from 'react';
import { api } from './api';
import { Sidebar, type Interval } from './components/Sidebar';
import { StatCards, sortCampaigns } from './components/StatCards';
import { useThroughputSocket } from './useThroughputSocket';
import type { CampaignDto, ProgressionPointDto, LiveStageDto } from './types';

export default function App() {
  const [campaigns, setCampaigns] = useState<CampaignDto[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [progression, setProgression] = useState<ProgressionPointDto[]>([]);
  const [liveStage, setLiveStage] = useState<LiveStageDto | null>(null);
  const [interval, setIntervalSec] = useState<Interval>(5);
  const { samples, connected } = useThroughputSocket();

  useEffect(() => {
    api.getCampaigns().then((cs) => {
      setCampaigns(cs);
      const sorted = sortCampaigns(cs);
      if (sorted.length) setSelectedId(sorted[0].campaignId);
    });
  }, []);

  useEffect(() => {
    if (selectedId == null) return;
    api.getProgression(selectedId).then(setProgression);
  }, [selectedId]);

  const sortedProg = [...progression].sort((a, b) => a.stageId - b.stageId);
  const activeStage = progression.find((p) => p.status === 'ACTIVE') ?? null;

  useEffect(() => {
    if (!activeStage) { setLiveStage(null); return; }
    let alive = true;
    const tick = () => api.getLiveStage(activeStage.stageId).then((d) => { if (alive) setLiveStage(d); });
    tick();
    const h = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(h); };
  }, [activeStage?.stageId]);

  const latestUps = samples.length ? samples[samples.length - 1].unitsPerSec : 0;
  const current = sortedProg[sortedProg.length - 1];
  const first = sortedProg[0];

  return (
    <div className="app">
      <Sidebar campaigns={campaigns} selectedId={selectedId} onSelect={setSelectedId}
               interval={interval} onIntervalChange={setIntervalSec}
               lastUpdated={new Date().toLocaleTimeString()} connected={connected} />
      <main className="main">
        {current && first && (
          <StatCards current={current} first={first} liveStage={liveStage} unitsPerSec={latestUps} />
        )}
        {/* charts + tables added in Tasks 11 and 12 */}
      </main>
    </div>
  );
}
```

- [ ] **Step 9: Run, expect PASS**

Run: `cd ramsey-ui-web && npm test -- StatCards && cd ..`
Expected: PASS (2 tests).

- [ ] **Step 10: Commit**

```bash
git add ramsey-ui-web/src/theme.css ramsey-ui-web/src/components ramsey-ui-web/src/App.tsx ramsey-ui-web/src/main.tsx
git commit -m "$(printf 'feat: app shell, dark theme, sidebar, stat cards\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_0169KJrUT5NQv2VBFWy9UuKt')"
```

---

## Task 11: Realtime throughput graph + interval control

**Files:**
- Create: `ramsey-ui-web/src/components/ThroughputChart.tsx`
- Modify: `ramsey-ui-web/src/App.tsx` (mount the chart as the hero panel)
- Test: `ramsey-ui-web/src/components/ThroughputChart.test.tsx`

**Interfaces:**
- Consumes: `samples: ThroughputSample[]` (from `useThroughputSocket`), `interval: Interval` (Task 10), `bucketSamples` (Task 9).
- Produces: `<ThroughputChart samples interval>` rendering a live area/line chart of work-units/sec, bucketed per the selected interval.

- [ ] **Step 1: Write the failing test** (renders, and reacts to interval by bucketing)

`src/components/ThroughputChart.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ThroughputChart } from './ThroughputChart';
import type { ThroughputSample } from '../types';

// Recharts needs layout; mock ResponsiveContainer to a fixed size.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
    <div style={{ width: 600, height: 300 }}>{children}</div> };
});

const s = (ts: number, ups: number): ThroughputSample => ({ ts, stageId: 1, unitsPerSec: ups });

describe('ThroughputChart', () => {
  it('renders an SVG path for the series', () => {
    const samples = Array.from({ length: 10 }, (_, i) => s(1000 + i * 1000, i * 10));
    const { container } = render(<ThroughputChart samples={samples} interval={1} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('does not throw when empty', () => {
    expect(() => render(<ThroughputChart samples={[]} interval={5} />)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd ramsey-ui-web && npm test -- ThroughputChart && cd ..`
Expected: FAIL — `./ThroughputChart` not found.

- [ ] **Step 3: Implement `src/components/ThroughputChart.tsx`**

```tsx
import { useMemo } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import type { ThroughputSample } from '../types';
import { bucketSamples } from '../throughput';
import type { Interval } from './Sidebar';
import { Card } from './Card';

const fmtTime = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour12: false });
const fmtNum = (n: number) => Math.round(n).toLocaleString('en-US');

export function ThroughputChart({ samples, interval }: { samples: ThroughputSample[]; interval: Interval }) {
  const data = useMemo(() => bucketSamples(samples, interval), [samples, interval]);
  const latest = data.length ? data[data.length - 1].ups : 0;

  return (
    <Card title={`Work units / sec — live (${interval}s)`} accent>
      <div className="chart-headline">{fmtNum(latest)}<span> u/s</span></div>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="ups" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.5} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" tickFormatter={fmtTime} stroke="var(--muted)" minTickGap={48} />
          <YAxis tickFormatter={fmtNum} stroke="var(--muted)" width={64} />
          <Tooltip
            contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 8 }}
            labelFormatter={(t) => fmtTime(Number(t))}
            formatter={(v: number) => [`${fmtNum(v)} u/s`, 'Throughput']} />
          <Area type="monotone" dataKey="ups" stroke="var(--accent)" strokeWidth={2}
                fill="url(#ups)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}
```

- [ ] **Step 4: Add the headline style to `theme.css`**

Append:
```css
.chart-headline { font-size: 30px; font-weight: 700; font-variant-numeric: tabular-nums; margin-bottom: 8px; }
.chart-headline span { font-size: 15px; color: var(--muted); font-weight: 500; margin-left: 6px; }
```

- [ ] **Step 5: Mount the chart in `App.tsx`** — directly under `<StatCards .../>` add:

```tsx
        <ThroughputChart samples={samples} interval={interval} />
```
and add the import: `import { ThroughputChart } from './components/ThroughputChart';`

- [ ] **Step 6: Run, expect PASS**

Run: `cd ramsey-ui-web && npm test -- ThroughputChart && cd ..`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add ramsey-ui-web/src/components/ThroughputChart.tsx ramsey-ui-web/src/components/ThroughputChart.test.tsx ramsey-ui-web/src/theme.css ramsey-ui-web/src/App.tsx
git commit -m "$(printf 'feat: realtime throughput graph with interval bucketing\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_0169KJrUT5NQv2VBFWy9UuKt')"
```

---

## Task 12: Historical charts + best-results table + raw data (full parity)

**Files:**
- Create: `ramsey-ui-web/src/components/CliqueProgressionChart.tsx`
- Create: `ramsey-ui-web/src/components/ImprovementChart.tsx`
- Create: `ramsey-ui-web/src/components/BestResultsTable.tsx`
- Create: `ramsey-ui-web/src/components/RawDataTable.tsx`
- Create: `ramsey-ui-web/src/format.ts` (`formatEdges`)
- Modify: `ramsey-ui-web/src/App.tsx`
- Test: `ramsey-ui-web/src/format.test.ts`

**Interfaces:**
- Consumes: `ProgressionPointDto[]`, `LiveStageDto`, `BestResultDto`.
- Produces: the four parity components + `formatEdges(r: BestResultDto): string` (`"[[0, 7]]"`, or `"(full-graph result)"`, or `"—"`).

- [ ] **Step 1: Write the failing test for `formatEdges`**

`src/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatEdges } from './format';

describe('formatEdges', () => {
  it('formats edge pairs including vertex 0', () => {
    expect(formatEdges({ cliqueCount: 1, edges: [[0, 7], [3, 9]], fullGraph: false }))
      .toBe('[[0, 7], [3, 9]]');
  });
  it('labels full-graph results', () => {
    expect(formatEdges({ cliqueCount: 1, edges: [], fullGraph: true })).toBe('(full-graph result)');
  });
  it('falls back to dash', () => {
    expect(formatEdges({ cliqueCount: 1, edges: [], fullGraph: false })).toBe('—');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd ramsey-ui-web && npm test -- format && cd ..`
Expected: FAIL — `./format` not found.

- [ ] **Step 3: Implement `src/format.ts`**

```ts
import type { BestResultDto } from './types';

export function formatEdges(r: BestResultDto): string {
  if (r.edges.length > 0) {
    return `[${r.edges.map(([u, v]) => `[${u}, ${v}]`).join(', ')}]`;
  }
  if (r.fullGraph) return '(full-graph result)';
  return '—';
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd ramsey-ui-web && npm test -- format && cd ..`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement `src/components/CliqueProgressionChart.tsx`**

```tsx
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import type { ProgressionPointDto } from '../types';
import { Card } from './Card';

const fmtNum = (n: number) => n.toLocaleString('en-US');

export function CliqueProgressionChart({ progression }: { progression: ProgressionPointDto[] }) {
  const data = [...progression].sort((a, b) => a.stageId - b.stageId)
    .map((p) => ({ stage: p.stageId, clique: p.cliqueCount, active: p.status === 'ACTIVE' }));
  return (
    <Card title="Clique Count Over Stages">
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="stage" stroke="var(--muted)" minTickGap={40} />
          <YAxis tickFormatter={fmtNum} stroke="var(--muted)" width={72} domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 8 }}
            formatter={(v: number) => [fmtNum(v), 'Cliques']} labelFormatter={(s) => `Stage ${s}`} />
          <Line type="monotone" dataKey="clique" stroke="var(--green)" strokeWidth={2}
                dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
```

- [ ] **Step 6: Implement `src/components/ImprovementChart.tsx`**

```tsx
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts';
import type { ProgressionPointDto } from '../types';
import { Card } from './Card';

export function ImprovementChart({ progression }: { progression: ProgressionPointDto[] }) {
  const sorted = [...progression].sort((a, b) => a.stageId - b.stageId);
  const data = sorted.slice(1).map((p, i) => ({
    stage: String(p.stageId),
    improvement: sorted[i].cliqueCount - p.cliqueCount, // positive = improvement
  }));
  return (
    <Card title="Improvement Per Stage">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="stage" stroke="var(--muted)" minTickGap={24} />
          <YAxis stroke="var(--muted)" width={56} />
          <Tooltip
            contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 8 }}
            formatter={(v: number) => [v.toLocaleString('en-US'), 'Δ cliques']} labelFormatter={(s) => `Stage ${s}`} />
          <Bar dataKey="improvement" isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.improvement >= 0 ? 'var(--green)' : 'var(--red)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}
```

- [ ] **Step 7: Implement `src/components/BestResultsTable.tsx`**

```tsx
import type { LiveStageDto } from '../types';
import { formatEdges } from '../format';
import { Card } from './Card';

const fmt = (n: number) => n.toLocaleString('en-US');

export function BestResultsTable({ liveStage, currentClique }: {
  liveStage: LiveStageDto | null; currentClique: number;
}) {
  const rows = liveStage?.bestResults ?? [];
  return (
    <Card title={`🏆 Best Novel Results — ${rows.length} retained`}>
      {rows.length === 0 ? (
        <p className="muted">No results submitted yet for this stage.</p>
      ) : (
        <table>
          <thead><tr><th>#</th><th>Clique Count</th><th>Δ vs Current</th><th>Edges to Flip</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{fmt(r.cliqueCount)}</td>
                <td>{fmt(r.cliqueCount - currentClique)}</td>
                <td>{formatEdges(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
```

- [ ] **Step 8: Implement `src/components/RawDataTable.tsx`**

```tsx
import { useState } from 'react';
import type { ProgressionPointDto } from '../types';
import { Card } from './Card';

const fmt = (n: number) => n.toLocaleString('en-US');

export function RawDataTable({ progression }: { progression: ProgressionPointDto[] }) {
  const [open, setOpen] = useState(false);
  const rows = [...progression].sort((a, b) => a.stageId - b.stageId);
  return (
    <Card>
      <button className="disclosure" onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} Raw Data ({rows.length} stages)
      </button>
      {open && (
        <table>
          <thead><tr><th>Stage</th><th>Graph ID</th><th>Clique Count</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.stageId}>
                <td>{p.stageId}</td><td>{p.graphId ?? '—'}</td><td>{fmt(p.cliqueCount)}</td>
                <td>{p.status}</td><td>{p.createdDate ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
```

- [ ] **Step 9: Add small styles to `theme.css`**

Append:
```css
.muted { color: var(--muted); }
.disclosure { background: none; border: none; color: var(--text); cursor: pointer; font-size: 14px; padding: 0; }
```

- [ ] **Step 10: Finish `App.tsx`** — render the parity components below the throughput chart. Add imports and, after `<ThroughputChart .../>`:

```tsx
        <div className="grid-2">
          <CliqueProgressionChart progression={progression} />
          <ImprovementChart progression={progression} />
        </div>
        <BestResultsTable liveStage={liveStage} currentClique={current?.cliqueCount ?? 0} />
        <RawDataTable progression={progression} />
```
Imports:
```tsx
import { CliqueProgressionChart } from './components/CliqueProgressionChart';
import { ImprovementChart } from './components/ImprovementChart';
import { BestResultsTable } from './components/BestResultsTable';
import { RawDataTable } from './components/RawDataTable';
```
And append to `theme.css`:
```css
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
```

- [ ] **Step 11: Full frontend build + test**

Run: `cd ramsey-ui-web && npm run build && npm test && cd ..`
Expected: `tsc -b` clean, Vite build succeeds (writes `target/classes/META-INF/resources`), all Vitest tests pass.

- [ ] **Step 12: Commit**

```bash
git add ramsey-ui-web/src
git commit -m "$(printf 'feat: historical charts, best-results + raw-data tables (parity)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_0169KJrUT5NQv2VBFWy9UuKt')"
```

---

## Task 13: Dockerfile, compose wiring, retire Streamlit, README

**Files:**
- Delete: `app.py`, `requirements.txt`, the old root `Dockerfile`'s Streamlit content (replace), `ramsey-ui.iml`, `__pycache__/`
- Create: `Dockerfile` (multi-stage, replaces the Streamlit one), `.dockerignore`
- Modify: `ramsey-mw/docker/main/ramsey-compose.yml` (and `m1-worker`, `dell-worker` variants) — the `ramsey-ui` service
- Modify: `README.md`

**Interfaces:**
- Produces: a single image that builds the Maven project and runs `ramsey-ui-rest` on port 8080, externally mapped at `36003`.

- [ ] **Step 1: Replace `Dockerfile` (multi-stage build)**

```dockerfile
# syntax=docker/dockerfile:1

# --- build stage: Maven builds the React SPA + Spring Boot jar ---
FROM --platform=$BUILDPLATFORM maven:3.9-eclipse-temurin-25 AS build
WORKDIR /build
COPY pom.xml ./
COPY ramsey-ui-web/pom.xml ramsey-ui-web/pom.xml
COPY ramsey-ui-rest/pom.xml ramsey-ui-rest/pom.xml
# Pre-fetch dependencies (best-effort cache layer)
RUN mvn -q -B -ntp dependency:go-offline || true
COPY . .
RUN mvn -q -B -ntp -DskipTests package

# --- runtime stage: slim JRE running the backend jar ---
FROM eclipse-temurin:25-jre AS runtime
WORKDIR /app
COPY --from=build /build/ramsey-ui-rest/target/ramsey-ui-rest-0.1.0.jar app.jar
RUN groupadd -r appgroup && useradd -r -g appgroup -m -d /home/appuser appuser
USER appuser
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

- [ ] **Step 2: Create `.dockerignore`**

```
**/target/
**/node_modules/
**/.git/
__pycache__/
*.iml
.tmp/
```

- [ ] **Step 3: Update the `ramsey-ui` service in `ramsey-mw/docker/main/ramsey-compose.yml`**

Change the port mapping from `36003:8501` to `36003:8080` and keep env/network/logging:
```yaml
  ramsey-ui:
    image: benferenchak/ramsey-ui:develop
    networks:
      - ramsey-net
    ports:
      - "36003:8080"
    environment:
      API_BASE_URL: http://ramsey-mw:8080
      REDIS_HOST: redis
      REDIS_PORT: 6379
    depends_on:
      ramsey-mw:
        condition: service_healthy
    logging:
      driver: loki
      options:
        loki-url: "https://loki.setminusx.cloud/loki/api/v1/push"
        mode: non-blocking
        max-buffer-size: 4m
        loki-retries: 5
```
Apply the same `36003:8501` → `36003:8080` change in `ramsey-mw/docker/m1-worker/ramsey-compose.yml` and `ramsey-mw/docker/dell-worker/ramsey-compose.yml` if they define a `ramsey-ui` service. (Do NOT push to Portainer.)

- [ ] **Step 4: Remove the Streamlit app files**

Run: `git rm app.py requirements.txt ramsey-ui.iml && git rm -r --ignore-unmatch __pycache__`
Expected: files staged for deletion.

- [ ] **Step 5: Rewrite `README.md`**

```markdown
# ramsey-ui

Dashboard for the Ramsey search. Multi-module Maven project:

- `ramsey-ui-web` — React + TypeScript (Vite) SPA, built by Maven.
- `ramsey-ui-rest` — Spring Boot read-only backend-for-frontend. Reads Redis live
  counters, proxies ramsey-mw for campaign/progression history, samples
  work-units/sec into an in-memory ring buffer, and pushes it over a STOMP WebSocket.

## Build & run

```bash
mvn clean package                      # builds SPA + backend jar
java -jar ramsey-ui-rest/target/ramsey-ui-rest-0.1.0.jar
# open http://localhost:8080
```

Frontend dev server (proxies /api and /ws to :8080):

```bash
cd ramsey-ui-web && npm run dev
```

### Configuration (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `API_BASE_URL` | `http://localhost:36000` | ramsey-mw base URL |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` | Redis (Dragonfly) |

### Docker

```bash
docker build -t benferenchak/ramsey-ui:develop .
```
Served on container port 8080 (compose maps host `36003:8080`).
```

- [ ] **Step 6: Verify the whole project builds from clean**

Run: `mvn -q clean package`
Expected: reactor builds `ramsey-ui-web` then `ramsey-ui-rest`; all backend + frontend tests pass; `ramsey-ui-rest/target/ramsey-ui-rest-0.1.0.jar` exists.

- [ ] **Step 7: Verify the jar boots and serves the SPA** (smoke test; no Redis/mw needed to load the page shell)

Run: `java -jar ramsey-ui-rest/target/ramsey-ui-rest-0.1.0.jar &` then `sleep 8 && curl -s localhost:8080/ | grep -o 'id="root"' && curl -s localhost:8080/actuator/health`
Expected: prints `id="root"` and `{"status":"UP"}`. Then stop it: `kill %1`.

- [ ] **Step 8: Commit**

```bash
git add Dockerfile .dockerignore README.md ../ramsey-mw/docker/main/ramsey-compose.yml
git commit -m "$(printf 'feat: multi-stage Docker build, compose wiring, retire Streamlit\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_0169KJrUT5NQv2VBFWy9UuKt')"
```

Note: the compose files live in the **ramsey-mw** repo, not ramsey-ui. Stage/commit them in that repo separately (same message is fine); they are listed here so the change isn't forgotten. Do not push either repo or touch Portainer without explicit confirmation.

---

## Self-Review (completed during planning)

- **Spec coverage:** multi-module Maven (T1, T2) ✓; read-only BFF reading Redis (T3) + mw REST (T4) ✓; active-stage resolution (T5) ✓; in-memory ring buffer (T6) ✓; sampler delta/re-baseline/clamp (T7) ✓; STOMP WebSocket broadcast + history endpoint (T7, T8) ✓; all REST endpoints (T8) ✓; React data layer + 1/5/30s bucketing (T9) ✓; shell/theme/sidebar/stat cards (T10) ✓; realtime throughput graph + interval control (T11) ✓; clique-progression + improvement + best-results + raw-data parity (T12) ✓; single-deployable Docker on 36003, compose edits local-only, Streamlit retired (T13) ✓; throughput-source constant + fallback (T3 `StageKeys`) ✓; testing strategy (tests in every backend + frontend task) ✓.
- **Placeholder scan:** no TBD/TODO; every code step contains complete code; every test step contains real assertions.
- **Type consistency:** record/field names (`ThroughputSample.ts/stageId/unitsPerSec`, `LiveStageDto`, `CampaignDto`, `ProgressionPointDto`, `BestResultDto.edges/fullGraph`) are identical across backend, REST, and frontend types; `StageCounterReader.readProcessedCount`, `ThroughputBuffer.snapshotSince`, `bucketSamples`, `mergeSample`, `sortCampaigns`, `formatEdges` are referenced with the same signatures where consumed.
