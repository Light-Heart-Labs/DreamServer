FROM node:22-bookworm-slim

ARG HERMES_AGENT_REPO=https://github.com/NousResearch/hermes-agent.git
ARG HERMES_AGENT_REF=5d3be898a8671eb9fb99cf18f43165502f54e7f4

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DREAM_DISABLE_PTY=1 \
    PORT=3010 \
    HERMES_DATA_DIR=/data/hermes \
    HERMES_WORKSPACE_ROOT=/data/hermes/workspace \
    DREAM_HERMES_ROOT=/opt/hermes-agent-src \
    DREAM_HERMES_PYTHON=/opt/hermes-venv/bin/python

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      git \
      python3 \
      python3-pip \
      python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY app/package.json ./package.json
RUN npm install --omit=dev --omit=optional --no-audit --no-fund

COPY app/ ./
RUN git init /opt/hermes-agent-src \
    && git -C /opt/hermes-agent-src remote add origin "$HERMES_AGENT_REPO" \
    && git -C /opt/hermes-agent-src fetch --depth 1 origin "$HERMES_AGENT_REF" \
    && git -C /opt/hermes-agent-src checkout --detach FETCH_HEAD \
    && python3 -m venv /opt/hermes-venv \
    && /opt/hermes-venv/bin/pip install --upgrade pip setuptools wheel \
    && /opt/hermes-venv/bin/pip install --no-cache-dir /opt/hermes-agent-src

RUN useradd --system --create-home --home-dir /home/hermes hermes \
    && mkdir -p /data/hermes \
    && chown -R hermes:hermes /app /data/hermes /opt/hermes-venv /opt/hermes-agent-src

USER hermes
EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=30s \
  CMD node -e "require('http').get('http://127.0.0.1:3010/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
