FROM python:3.12-slim

# ffmpeg + libsndfile let FunASR decode the uploaded audio files; git lets
# trust_remote_code model definitions fetch cleanly.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libsndfile1 git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY server.py /app/server.py

# Models download into the modelscope cache, which compose bind-mounts to
# ./data/sensevoice for persistence across restarts.
ENV MODELSCOPE_CACHE=/root/.cache/modelscope

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
