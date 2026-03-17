FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/data

# Create non-root user and set ownership
RUN adduser --system --no-create-home --uid 1000 dreamer && \
    chown -R dreamer:nogroup /app

EXPOSE 8080

# Health check (uses shell form for env var expansion)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD sh -c 'python3 -c "import urllib.request; urllib.request.urlopen(\"http://localhost:${UVICORN_PORT:-8080}/health\")" || exit 1'

USER dreamer

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${UVICORN_PORT:-8080} --log-level info"]
