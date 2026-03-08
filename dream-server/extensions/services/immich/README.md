# Immich Extension for Dream Server

## Overview

Immich is a high-performance self-hosted photo and video backup solution. It provides a mobile app for automatic backup and a web interface for browsing, organizing, and sharing your media library.

## Features

- Automatic mobile photo/video backup (iOS & Android)
- AI-powered face recognition and clustering
- Object detection and smart search
- Duplicate detection
- Album creation and sharing
- Timeline and map views
- RAW format support
- Hardware-accelerated transcoding

## Usage

### Enable the extension

```bash
dream extensions enable immich
```

### Access Immich

```
http://localhost:${IMMICH_PORT:-2283}
```

### First Setup

1. Open the web UI
2. Create an admin account
3. Download the mobile app
4. Configure server URL and login
5. Enable auto-backup in app settings

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `IMMICH_PORT` | 2283 | Web UI port |
| `IMMICH_DB_USERNAME` | immich | PostgreSQL username |
| `IMMICH_DB_PASSWORD` | immich | PostgreSQL password |
| `IMMICH_DB_NAME` | immich | PostgreSQL database name |

## Data Directories

| Path | Purpose |
|------|---------|
| `./data/immich/upload/` | Photo/video storage |
| `./data/immich/postgres/` | Database files |
| `./data/immich/model-cache/` | ML model cache |

## GPU Acceleration

For hardware-accelerated ML inference and transcoding, modify the compose file:
- Machine Learning: Add `-cuda` suffix to image tag
- Transcoding: Use NVENC for NVIDIA GPUs

## Integration

Immich integrates with:
- **Mobile apps** — iOS and Android auto-backup
- **n8n workflows** — Trigger on new uploads
- **LLM API** — Generate descriptions via future integration

## Uninstall

```bash
dream extensions disable immich
```

Media in `./data/immich/` is preserved.

## Documentation

- Website: <https://immich.app/>
- Docs: <https://immich.app/docs/>
- GitHub: <https://github.com/immich-app/immich>
