# syntax=docker/dockerfile:1

# --- build stage: Maven builds the React SPA + Spring Boot jar (once, on the build arch) ---
FROM --platform=$BUILDPLATFORM maven:3.9-eclipse-temurin-25 AS build
WORKDIR /build
COPY pom.xml ./
COPY ramsey-ui-web/pom.xml ramsey-ui-web/pom.xml
COPY ramsey-ui-rest/pom.xml ramsey-ui-rest/pom.xml
# Best-effort dependency prefetch for layer caching (inter-module deps resolve at package time).
RUN mvn -q -B -ntp dependency:go-offline || true
COPY . .
RUN mvn -q -B -ntp -DskipTests package

# --- runtime stage: slim JRE running the backend jar (per target arch) ---
FROM eclipse-temurin:25-jre AS runtime
WORKDIR /app
COPY --from=build /build/ramsey-ui-rest/target/ramsey-ui-rest-0.1.0.jar app.jar
RUN groupadd -r appgroup && useradd -r -g appgroup -m -d /home/appuser appuser
USER appuser
EXPOSE 8501
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
