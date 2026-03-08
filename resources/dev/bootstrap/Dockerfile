# ============================================================================
# DreamServer Bootstrap Image
# ============================================================================
# A runtime environment for the DreamServer installer. Contains all
# dependencies (git, python, jq, yq, Docker CLI). The actual installer
# code is ALWAYS cloned fresh at runtime — updates flow automatically.
#
# Usage:
#   docker run --rm -it \
#     -v /var/run/docker.sock:/var/run/docker.sock \
#     -v ~/dream-server:/opt/dream-server \
#     ghcr.io/light-heart-labs/dream-bootstrap:latest
#
# Pass installer flags:
#   docker run ... dream-bootstrap:latest --all --tier 3
# ============================================================================

FROM ubuntu:24.04

LABEL org.opencontainers.image.title="DreamServer Bootstrap"
LABEL org.opencontainers.image.description="Installer runtime for DreamServer — local AI for everyone"
LABEL org.opencontainers.image.source="https://github.com/Light-Heart-Labs/DreamServer"
LABEL org.opencontainers.image.licenses="Apache-2.0"

# Avoid interactive prompts during apt-get
ENV DEBIAN_FRONTEND=noninteractive

# Install all dependencies the installer scripts need
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    git \
    curl \
    ca-certificates \
    python3 \
    python3-yaml \
    jq \
    rsync \
    pciutils \
    iproute2 \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Install yq (YAML processor used by service manifests and extension system)
RUN ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://github.com/mikefarah/yq/releases/latest/download/yq_linux_${ARCH}" \
    -o /usr/local/bin/yq && chmod +x /usr/local/bin/yq

# Install Docker CLI + Compose plugin (no daemon — we control the host Docker via socket)
# The static tarball includes docker CLI; compose plugin is installed separately
RUN ARCH=$(uname -m) && \
    curl -fsSL "https://download.docker.com/linux/static/stable/${ARCH}/docker-27.5.1.tgz" \
    | tar xz --strip-components=1 -C /usr/local/bin docker/docker

# Install Docker Compose plugin (required by install.sh for 'docker compose up')
# Compose uses uname -m naming: x86_64, aarch64 (not amd64/arm64)
RUN ARCH=$(uname -m) && \
    mkdir -p /usr/local/lib/docker/cli-plugins && \
    curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${ARCH}" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose && \
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

WORKDIR /opt/dream-server

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
