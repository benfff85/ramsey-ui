# ramsey-ui

Real-time dashboard for the Ramsey search. A multi-module Maven project:

- **`ramsey-ui-web`** — React + TypeScript (Vite) single-page app, built by Maven.
- **`ramsey-ui-rest`** — Spring Boot **read-only** backend-for-frontend. Reads Redis
  live counters, proxies `ramsey-mw` for campaign/progression history, samples
  work-units/sec into an in-memory ring buffer, and streams it to the UI over a STOMP
  WebSocket. It never writes — `ramsey-mw` still owns all persistence.

The web bundle is packaged into the backend jar (`META-INF/resources`), so the whole
dashboard ships as a single container on port **36003**.

## Build & run

    mvn clean package
    java -jar ramsey-ui-rest/target/ramsey-ui-rest-0.1.0.jar
    # open http://localhost:8080

Frontend dev server (hot reload; proxies `/api` and `/ws` to the backend on :8080):

    cd ramsey-ui-web && npm install && npm run dev

Run the tests:

    mvn test                              # backend (JUnit)
    cd ramsey-ui-web && npm test          # frontend (Vitest)

## Configuration (environment)

| Var | Default | Meaning |
|-----|---------|---------|
| `API_BASE_URL` | `http://localhost:36000` | `ramsey-mw` base URL |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` | Redis (Dragonfly) |

## Docker

    docker build -t benferenchak/ramsey-ui:develop .

The container listens on port `8080`; the compose stack maps host `36003:8080`.
