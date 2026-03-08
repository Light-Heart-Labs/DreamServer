# M3 Privacy Shield
# OpenAI-compatible proxy with PII filtering via Presidio

FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    python -m spacy download en_core_web_lg

# Copy application
COPY proxy.py shield.py custom_recognizers.py ./

# Config
ENV LOCAL_LLM_URL=http://host.docker.internal:8000
ENV PRIVACY_MODE=on
ENV MIN_PII_SCORE=0.4
ENV PORT=5000

EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD curl -f http://localhost:5000/health || exit 1

CMD ["python", "proxy.py"]
