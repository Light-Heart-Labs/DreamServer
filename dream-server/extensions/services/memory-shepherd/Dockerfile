FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# Non-root user — mirrors the APE service pattern
RUN adduser --system --no-create-home shepherd

# Data directories are mounted at runtime; create placeholders so the
# container starts cleanly even if the host volumes are absent.
RUN mkdir -p /data/memory /data/sessions /config \
    && chown shepherd /data/memory /data/sessions /config

EXPOSE 7891

USER shepherd

CMD ["python", "main.py"]
