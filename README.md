# Functional Accelerator

> Internal web tool for AI-powered functional analysis. Upload as-is/to-be documentation, trigger Claude-powered impact analysis, and get functional impacts, UI/UX impacts, and a rendered visual prototype — all in one place.

---

## Architecture

```
functional-accelerator/
├── backend/          Node.js + Express + TypeScript + SQLite
│   ├── src/
│   │   ├── db/       SQLite schema & migrations
│   │   ├── routes/   REST API (projects, files, analysis)
│   │   └── services/ Claude, fileParsing, promptBuilder, mockAnalysis
│   └── uploads/      local file storage (gitignored)
└── frontend/         React + Vite + TypeScript + Tailwind CSS
    └── src/
        ├── pages/    ProjectsPage, ProjectDetailPage
        ├── components/ Shell, FileUploader, FileList, AnalysisTabs, PrototypePreview
        ├── services/  api.ts (typed Axios client)
        └── types/     shared TypeScript interfaces
```

---

## Prerequisites

- **Node.js** >= 18
- **npm** >= 9
- An **Anthropic API key** (or run in mock mode — no key needed)

---

## Installation

```bash
# Clone / open the repo
cd functional-accelerator

# Install backend deps
cd backend && npm install

# Install frontend deps
cd ../frontend && npm install
```

---

## Environment Variables

```bash
# Backend
cd backend
cp .env.example .env
# Edit .env — set your ANTHROPIC_API_KEY or keep CLAUDE_MOCK=true for demo mode
```

Key variables:

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Your Anthropic key (required in real mode) |
| `CLAUDE_MOCK` | `true` | Set `false` to use real Claude API |
| `CLAUDE_MODEL` | `claude-opus-4-5` | Model to use |
| `PORT` | `3001` | Backend port |
| `MAX_FILE_SIZE_MB` | `20` | Max upload size |

---

## Running Locally

**Terminal 1 — Backend:**
```bash
cd backend
npm run dev
# → http://localhost:3001
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
# → http://localhost:5173
```

Open [http://localhost:5173](http://localhost:5173)

---

## End-to-End Flow

1. **Create a project** — give it a name and description
2. **Upload documents** — drag & drop into the three buckets:
   - **As-Is** — current state docs (PDF, DOCX, TXT, MD, XLSX)
   - **To-Be** — requirements / BRD / target state docs
   - **Screenshots** — PNG/JPG of current UI screens
3. **Click "Analyze Impacts"** — Claude processes all documents
4. **Review results** across tabs:
   - Executive Summary · Functional Impacts · UI/UX Impacts
   - Affected Screens · Open Questions · **Prototype Preview**
5. **Prototype Preview** — renders Claude's generated HTML mockup in a sandboxed iframe

---

## Mock Mode (No API Key)

By default the `.env` has `CLAUDE_MOCK=true`. This returns a realistic fixture analysis (expense management approval workflow) so you can demo the full UI without an API key.

To use real Claude: set `CLAUDE_MOCK=false` and provide `ANTHROPIC_API_KEY`.

---

## Supported File Types

| Format | Text extracted |
|---|---|
| PDF | ✅ via `pdf-parse` |
| DOCX | ✅ via `mammoth` |
| TXT / MD | ✅ direct read |
| XLSX / XLS | ✅ via `xlsx` (CSV-like) |
| PNG / JPG / WEBP | Vision (base64 to Claude) |

---

## MVP Limitations

- No user authentication — single-user local tool
- No real-time streaming (analysis polls every 2s)
- Max 10 images sent to Claude per analysis
- prototypeHtml rendered in sandboxed iframe (no JS execution)
- No export/PDF of analysis
- SQLite only — not suitable for concurrent multi-user production use

---

## Possible Evolutions

- Auth layer (Clerk / Auth0)
- Streaming Claude responses
- Export to PDF / Confluence
- Multi-user with PostgreSQL
- Version diffing between analyses
- RAG/embedding-based document retrieval
- Integration with Jira / ADO for impact tickets
