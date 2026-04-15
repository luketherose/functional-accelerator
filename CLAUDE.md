# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Dev Commands

```bash
# Backend (http://localhost:3001)
cd backend && npm run dev          # ts-node-dev with hot reload

# Frontend (http://localhost:5173)
cd frontend && npm run dev         # Vite dev server

# Type-check (no emit)
cd backend  && npx tsc --noEmit
cd frontend && npx tsc --noEmit

# Lint frontend
cd frontend && npm run lint

# Production build
cd backend  && npm run build       # outputs dist/
cd frontend && npm run build       # outputs dist/
```

Run backend and frontend in separate terminals. No Docker, no monorepo tooling.

**Mock mode** (no Claude API key needed):
```bash
cd backend && CLAUDE_MOCK=true npm run dev
```

### Environment variables (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required when `CLAUDE_MOCK=false` |
| `CLAUDE_MOCK` | `true` | `false` to hit the real Claude API |
| `CLAUDE_MODEL` | `claude-opus-4-5` | Model used for all Claude calls |
| `PORT` | `3001` | Backend port |
| `MAX_FILE_SIZE_MB` | `20` | Max upload size |

---

## Product

Two distinct tools in one app, both under the same project workspace:

| Module | Entry point | What it does |
|---|---|---|
| **Functional Analysis** | `ProjectDetailPage` → "Analisi" tab | Compares AS-IS vs TO-BE documents, outputs functional/UI impacts, business rules, HTML prototype |
| **Defect Intelligence Platform** | `ProjectDetailPage` → "Risk Analysis" tab | Ingests ALM defect exports (Excel/CSV), clusters them, tracks risk over time |

---

## Architecture

### Backend (`backend/src/`)

```
routes/          ← thin Express handlers (5 routers mounted at /api/*)
  projects.ts    ← CRUD for projects
  files.ts       ← file upload, RAG indexing, preview
  analysis.ts    ← functional analysis pipeline (async, polled by frontend)
  risk.ts        ← legacy risk assessment (older, separate from UAT)
  uat.ts         ← Defect Intelligence Platform — see routing note below

services/        ← all business logic
  pipeline.ts          functional analysis: 5-step RAG pipeline
  promptBuilder.ts     all Claude prompt construction (never ad-hoc strings)
  claude.ts            Claude API client, response parser, mock toggle
  uatPipeline.ts       UAT: 4-step deterministic pipeline
  taxonomy.ts          default keyword taxonomy + classifyDefects()
  almParser.ts         Excel/CSV ALM export parser → normalised Defect[]
  clusterSuggestions.ts  Claude call to discover hidden themes in "Other" defects
  fileParsing.ts       text extraction: PDF (pdf-parse), DOCX (mammoth), XLSX (xlsx), TXT/MD, PNG/JPG/WEBP (base64 vision)
  vectorStore.ts       embedding storage + cosine similarity search (RAG)
  embeddings.ts        Claude API embedding generation
  chunking.ts          document chunking strategies for RAG
  retrieval.ts         multi-query RAG retrieval + formatting
  imageRenderer.ts     HTML → PNG via Puppeteer
  mockAnalysis.ts      fixture data for CLAUDE_MOCK=true

db/index.ts      ← SQLite schema init (better-sqlite3, WAL mode, sync API)
types/index.ts   ← all TypeScript types shared across routes/services
```

### Frontend (`frontend/src/`)

```
pages/
  ProjectsPage.tsx       list / create / delete projects
  ProjectDetailPage.tsx  main workspace — owns all state, two top-level tabs

components/
  ── Functional Analysis ──
  AnalysisTabs.tsx        tabbed result display (impacts, screens, rules, prototype)
  AnalysisProgress.tsx    progress indicator during async run
  ImpactDeepDive.tsx      per-impact RAG-backed chat
  ImpactPrototype.tsx     upload screenshot → generate HTML prototype
  PrototypePreview.tsx    iframe renderer with DOMPurify sanitisation

  ── Defect Intelligence ──
  UATDashboard.tsx        main overview: WAW donut, KPIs, risk areas, prevention
  UATTrend.tsx            cluster time-series across all runs (line + stacked bar)
  RunComparison.tsx       side-by-side diff of any two completed runs
  ClusterDrillDown.tsx    cluster → defect table with priority override UI
  TaxonomyEditor.tsx      keyword editor for defect clusters (per-project)
  AuditTrail.tsx          project-level log of all risk overrides
  ClusterSuggestions.tsx  Claude-powered discovery of new cluster themes
  DiagnosticInsights.tsx  derived risk insights from trend data
  AIDefectChat.tsx        AI Defect Copilot — conversational Claude interface per-run

services/api.ts     all Axios calls (projectsApi, filesApi, analysisApi, uatApi)
services/uatReport.ts  jsPDF + jsPDF-autotable PDF report generation
types/index.ts      mirrors backend types — keep in sync manually
```

### Data flow — Functional Analysis
1. User uploads files (bucket: `as-is | to-be | business-rules`) via `POST /api/files/:projectId/upload`
2. User clicks "Analizza" → `POST /api/analysis/:projectId/run` returns immediately with `analysisId`
3. Backend runs 5-step pipeline async (RAG retrieval → prompt build → Claude call → parse → save)
4. Frontend polls `GET /api/projects/:id` every 2s until status = `done`
5. Result JSON stored in `analyses.result_json`; parsed and rendered by `AnalysisTabs`

### Data flow — Defect Intelligence
1. User uploads one or more ALM Excel/CSV files → `POST /api/uat/:projectId/run` (multipart, field name `files`, up to 20)
2. Each file parsed by `almParser.ts`; defects merged and **deduplicated by `external_id`** (first-file-wins). One `ingestion_runs` record per file for provenance.
3. `uatPipeline.ts` runs async:
   - Step 1: compute stats locally (no AI)
   - Step 2: classify defects via keyword taxonomy → `cluster_assignments`
   - Step 3: per-cluster Claude summaries (one batched call)
   - Step 4: executive summary + delta vs previous run
4. Frontend polls `GET /api/uat/:projectId` every 2s until status = `done`
5. Result JSON in `uat_analyses.result_json`; clusters also queryable from DB

---

## Critical: UAT Route Ordering

`backend/src/routes/uat.ts` has specific 2-segment GET routes (`/cluster-trend`, `/taxonomy`, `/overrides`, `/compare`, `/defects/all`) that **must be registered before** the generic `GET /:projectId/:analysisId` handler. Express matches routes in definition order; the generic handler intercepts all 2-segment paths if placed first.

Current correct order (see file):
1. All `/:projectId/[specific-name]` routes
2. `GET /:projectId/:analysisId` ← generic, must be last among GET 2-segment routes
3. `GET /:projectId/:analysisId/...` sub-resource routes
4. POST/DELETE routes (no conflict, different HTTP methods)

**Always add new specific GET routes before the `GET /:projectId/:analysisId` handler in `uat.ts`.** POST routes on `/:projectId/:analysisId/...` (like `ai-chat`) are safe anywhere — different HTTP method, no conflict.

---

## Database Schema (key tables)

```
projects            id, name, description, status, timestamps
files               id, project_id, name, bucket(as-is|to-be|business-rules), extracted_text
file_chunks         id, file_id, content, embedding(BLOB) — for RAG
analyses            id, project_id, version_name, status, result_json
uat_analyses        id, project_id, version_name, status, file_name, defect_count, result_json
defects             id, external_id, project_id, ingestion_run_id, title, priority, application, module, ...
cluster_assignments id, uat_analysis_id, defect_id, cluster_key, method(rule|unclassified), matched_keywords
cluster_configs     id, project_id, cluster_key, keywords(JSON) — per-project taxonomy overrides
risk_overrides      id, defect_id, project_id, original_priority, overridden_priority, reason
ingestion_runs      id, project_id, uat_analysis_id, file_name, defect_count
```

All queries use `better-sqlite3` prepared statements (sync API — no async/await in DB calls).

---

## Type Sync Contract

`backend/src/types/index.ts` and `frontend/src/types/index.ts` must be kept in sync manually. The key shared types are `UATAnalysisResult`, `AnalysisResult`, and `ClusterSummary`. When adding fields to either, update both files and `mockAnalysis.ts`.

---

## Claude Prompt Rules

- All prompts built in `promptBuilder.ts` — never inline strings in routes or services
- Always instruct Claude to return **raw JSON only** (no markdown fences, no prose)
- Cap extracted text at 30k chars per file
- AS-IS and TO-BE content must appear in separate prompt sections
- Test prompt changes with `CLAUDE_MOCK=true` first
- Images attached as base64 vision blocks **before** the text prompt block

---

## Invariants — Do Not Break

- **Mock mode**: `CLAUDE_MOCK=true` must always return valid fixture data. Touch `mockAnalysis.ts` when changing `AnalysisResult` shape.
- **DOMPurify**: prototype HTML is sanitised before iframe injection in `PrototypePreview.tsx`. Never remove this.
- **SQLite WAL + FK**: both enabled at DB init; do not disable.
- **Uploads gitignored**: `backend/uploads/` and `backend/data/` are local-only.
- **Risk overrides are effective priority**: all cluster queries must `COALESCE(ro.overridden_priority, d.priority)` — the raw `d.priority` alone is wrong after an override.
- **FileBucket values**: `as-is`, `to-be`, `business-rules` (not `screenshot` — that was an earlier design).
- **Max images**: at most 10 images are sent to Claude per analysis run (enforced in `pipeline.ts`).
- **No streaming**: analysis is async and polled by the frontend every 2s — do not introduce SSE/WebSocket without updating both sides.
