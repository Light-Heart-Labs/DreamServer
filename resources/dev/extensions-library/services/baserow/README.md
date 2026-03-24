# Baserow Extension

Open-source no-code database tool and Airtable alternative.

## Overview

Baserow is a self-hosted database application platform that provides a spreadsheet-like interface for creating databases, tables, and views. It's the best open-source alternative to Airtable with zero storage restrictions and full data ownership.

## Features

- **No-code database** — Create databases with a spreadsheet interface
- **Multiple views** — Grid, gallery, form, and calendar views
- **REST API** — Headless API for all data operations
- **Collaboration** — Real-time collaboration and permissions
- **Self-hosted** — Full control over your data
- **MIT licensed** — Open-core with all core features open source

## Configuration

The extension uses the following environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `BASEROW_PUBLIC_URL` | Public URL for Baserow | `http://localhost:3007` |
| `BASEROW_PORT` | External port | `3007` |
| `BASEROW_DATABASE_HOST` | PostgreSQL host | (auto-detected) |
| `BASEROW_DATABASE_PASSWORD` | Database password | (auto-generated) |
| `BASEROW_DEBUG` | Enable debug mode | `false` |

## Ports

- External: `3007` (configurable via `BASEROW_PORT`)
- Internal: `80`

## Data Persistence

Database and application data are stored in:
```
./data/baserow/
```

## Security

- Runs with `no-new-privileges:true` flag
- Resource limits: 2 CPUs, 4GB memory

## Healthcheck

The extension exposes `/api/_health/` endpoint for monitoring.

## Usage

1. Start the extension: `dream enable baserow`
2. Access the UI at `http://localhost:3007`
3. Create your first database using the spreadsheet interface
