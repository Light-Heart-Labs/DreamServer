# Dream Server Dashboard API
# Lightweight system status backend for the Dashboard UI

FROM python:3.11-slim

LABEL org.opencontainers.image.source="https://github.com/Light-Heart-Labs/DreamServer"
LABEL org.opencontainers.image.description="Dream Server Dashboard API"

WORKDIR /app

# Install system deps for GPU metrics access
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY main.py config.py models.py security.py gpu.py helpers.py agent_monitor.py user_extensions.py session_signer.py ./
COPY routers/ routers/

# Non-root user
RUN useradd -m -u 1000 dreamer

# B1 fix: Create /data directory and make it writable for API key generation
RUN mkdir -p /data && chown dreamer:dreamer /data

USER dreamer

ENV DASHBOARD_API_PORT=3002

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${DASHBOARD_API_PORT}/health || exit 1

EXPOSE ${DASHBOARD_API_PORT}

CMD uvicorn main:app --host 0.0.0.0 --port ${DASHBOARD_API_PORT}
