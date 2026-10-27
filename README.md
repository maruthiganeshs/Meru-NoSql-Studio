# Meru-NoSql-Studio

Live OpenSearch / Elasticsearch console — FastAPI + SQLite (Docker) backend and React SPA.

**v1 scope:** connections, cluster health, indices, schema, document browser, query editor, import/export.  
No app login. No historical capacity metrics (separate from time-series dashboards).

## Quick start (dev)

### Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
pip install -r requirements.txt
set APP_SECRET_KEY=dev-change-me-generate-a-fernet-key
set DATABASE_URL=sqlite+aiosqlite:///../data/studio.db
# PowerShell:
# $env:APP_SECRET_KEY="dev-change-me-generate-a-fernet-key"
# $env:DATABASE_URL="sqlite+aiosqlite:///../data/studio.db"
uvicorn app.main:app --reload --port 8001
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 (proxies `/api` → `http://127.0.0.1:8001`).

### Docker

```bash
cp .env.example .env
# set APP_SECRET_KEY
docker compose up --build
```

API: http://localhost:8000 — serve a production UI build into `backend/static` or use Vite in dev.

## Features

- Multiple saved connections (secrets encrypted at rest with `APP_SECRET_KEY`)
- Strict auth for remote clusters (basic or API key required)
- Cluster overview, nodes, indices (size, docs, shards, aliases)
- Schema viewer on dashboard and in document browser
- Multi-index tabs, advanced table filters, JSON document drawer
- Monaco query editor, sample queries, query history
- Import with **mandatory explicit field types** (no silent type fallback)
- Extensible provider interface for future engines / user login

## API

- `GET /api/health`
- `CRUD /api/connections`, `POST /api/connections/{id}/test`
- `GET /api/os/{id}/cluster|nodes|indices`
- `GET /api/os/{id}/indices/{index}/mapping`
- `POST /api/os/{id}/indices/{index}/search|query`
- `GET /api/os/{id}/indices/{index}/docs/{doc_id}`
- `POST /api/os/{id}/import|export|infer-types`
- Sample queries & history under `/api/sample-queries`, `/api/connections/{id}/query-history`
