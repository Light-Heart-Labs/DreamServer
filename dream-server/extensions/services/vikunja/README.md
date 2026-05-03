# Vikunja — Project & Task Management

Self-hosted Kanban / list / Gantt project manager backed by Postgres. Used by Dream Server
to track AI-managed projects and to give Open Claw (Pi 5) a place to write its task updates.

## Quick start

```bash
# Generate secrets (or let setup.sh do it on next install run)
echo "VIKUNJA_DB_PASSWORD=$(openssl rand -hex 24)" >> .env
echo "VIKUNJA_JWT_SECRET=$(openssl rand -hex 32)"  >> .env

dream enable vikunja
dream start vikunja
```

Open http://localhost:3456 (or `BIND_ADDRESS:VIKUNJA_PORT`) and create your first user.

## API access for Open Claw

1. Log into Vikunja → **Settings → API Tokens**
2. Create a token with `write` scope on `projects` + `tasks`
3. Paste it into `.env`:
   ```
   VIKUNJA_API_TOKEN=tk_xxxxxxxxxxxxxxxxxxxx
   ```
4. `dream restart vikunja openclaw`

The token is then available to:
- The dashboard-api `/api/projects/*` proxy (used by the Projects page)
- Open Claw running on the Pi 5 (consumed via `VIKUNJA_BASE_URL` + `VIKUNJA_API_TOKEN`)

## Endpoints used by the dashboard

- `GET  /api/v1/info` — health
- `GET  /api/v1/projects` — list
- `GET  /api/v1/projects/{id}/tasks` — tasks per project
- `PUT  /api/v1/projects/{id}/tasks` — create task (Open Claw write path)
- `POST /api/v1/tasks/{id}` — update task

## Data layout

- `./data/vikunja/files/` — Vikunja attachments
- `./data/vikunja/postgres/` — Postgres data dir

Both directories are bind-mounted (DreamServer convention — no named volumes).

