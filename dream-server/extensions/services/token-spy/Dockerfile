FROM python:3.12-slim

WORKDIR /app

# Run as non-root (aligns with dashboard-api, privacy-shield)
RUN groupadd -r dreamer && useradd -r -g dreamer -u 1000 -m dreamer

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/data && chown -R dreamer:dreamer /app

USER dreamer

EXPOSE 8080

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${UVICORN_PORT:-8080} --log-level info"]
