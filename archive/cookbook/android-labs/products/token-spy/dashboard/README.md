# Token Spy Dashboard

Real-time analytics visualization for LLM API usage and costs.

## Tech Stack

- **Framework**: React + TypeScript + Vite
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui + Tremor (analytics components)
- **Charts**: Recharts
- **State**: TanStack Query (server state) + Zustand (client state)
- **Real-time**: Server-Sent Events (SSE)

## Features

- 📊 Real-time token usage charts
- 💰 Cost tracking per provider/model/agent
- 🔍 Session boundary visualization
- ⚠️ Usage threshold alerts
- 📈 Time-series analytics

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Architecture

See DESIGN.md for full architecture documentation.
