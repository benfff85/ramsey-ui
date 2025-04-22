# syntax=docker/dockerfile:1

# Use a multi-arch compatible Python base image for ARM64 (Graviton, Apple Silicon) and x86_64
FROM --platform=$BUILDPLATFORM python:3.11-slim as base

# Set working directory
WORKDIR /app

# Install system dependencies (if needed)
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app.py ./

# Add a non-root user and switch to it (similar to Java Dockerfile)
RUN groupadd -r appgroup && useradd -r -g appgroup appuser
USER appuser

# Expose Streamlit default port
EXPOSE 8501

# Set entrypoint for Streamlit app (similar to Java ENTRYPOINT style)
ENTRYPOINT ["sh", "-c", "streamlit run /app/app.py --server.port=8501 --server.address=0.0.0.0"]
