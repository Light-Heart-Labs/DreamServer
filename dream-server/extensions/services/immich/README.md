# Immich Extension

Self-hosted photo and video management system with AI-powered features.

## Overview

Immich is a high-performance photo and video backup solution that runs on your own server. It offers automatic backups from your mobile device, AI-powered organization, and privacy-first design.

## Features

- **Automatic Backup**: Backup photos and videos from your mobile device
- **AI Organization**: Face recognition, object detection, and automatic tagging
- **Privacy First**: All data stays on your server
- **Web Interface**: Access photos and videos from any browser

## Configuration

### Environment Variables

- `IMMICH_PORT` - Port for web interface (default: 2283)
- `LLM_API_URL` - URL for your LLM API (from .env)
- `IMMICH_DB_USER` - PostgreSQL username (default: postgres)
- `IMMICH_DB_PASS` - PostgreSQL password (default: postgres)
- `IMMICH_DB_NAME` - Database name (default: immich)
- `IMMICH_REDIS_HOST` - Redis hostname (default: redis)
- `IMMICH_REDIS_PORT` - Redis port (default: 6379)

### Volumes

- `./data/immich/upload` - Uploaded photos and videos
- `./data/immich/backup` - Backup storage
- `./data/immich/postgres` - Database storage
- `./data/immich/redis` - Redis cache

### Ports

- `2283` - Web interface
- `5432` - PostgreSQL (internal)
- `6379` - Redis (internal)

## Quick Start

```bash
# Add to your dream-server/extensions/enabled.yaml
- immich

# Start the extension
cd dream-server
./dream.sh up immich

# Or with docker-compose
docker-compose -f extensions/services/immich/compose.yaml up -d
```

## Usage

### Web Interface

Access the web interface at `http://localhost:2283`.

### Mobile App

Download the Immich app for iOS or Android and connect to your server.

## Links

- [Immich Documentation](https://immich.app/docs)
- [GitHub Repository](https://github.com/immich-app/immich)
- [Docker Hub](https://hub.docker.com/r/immichapp/immich-server)
