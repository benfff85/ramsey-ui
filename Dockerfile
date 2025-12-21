# syntax=docker/dockerfile:1

# Use a multi-arch compatible Python base image for ARM64 (Graviton, Apple Silicon) and x86_64
FROM --platform=$BUILDPLATFORM python:3.11-slim AS base

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

# Add a non-root user with home directory and switch to it
RUN groupadd -r appgroup && useradd -r -g appgroup -m -d /home/appuser appuser
RUN chown -R appuser:appgroup /app

# Set Streamlit home to a writable location
ENV STREAMLIT_HOME=/home/appuser/.streamlit

USER appuser

# Expose Streamlit default port
EXPOSE 8501

# Set entrypoint for Streamlit app
ENTRYPOINT ["sh", "-c", "streamlit run /app/app.py --server.port=8501 --server.address=0.0.0.0"]

