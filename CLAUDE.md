# CLAUDE.md — Working guide for Functional Accelerator

This file provides operational instructions for any developer (human or AI) working on this project.

---

## Product Objective

An internal web tool that lets functional analysts:
1. Upload current-state (as-is) and target-state (to-be) documentation
2. Trigger Claude-powered analysis
3. Receive structured functional impacts, UI/UX impacts, business rules, and a rendered HTML prototype

The tool accelerates functional analysis phases in consulting/delivery projects.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS v3 |
| Backend | Node.js + Express + TypeScript (ts-node-dev) |
| Database | SQLite via `better-sqlite3` |
| AI | Anthropic Claude via `@anthropic-ai/sdk` |
| File parsing | `pdf-parse`, `mammoth`, `xlsx` |
| File upload | `multer` (multipart) |

---

## Architectural Principles

1. **Clean separation** — frontend never calls Claude directly; all AI logic lives in the backend
2. **As-is vs To-be is a first-class concept** — the `bucket` field on every file is `as-is | to-be | screenshot`
3. **Mock mode always works** — `CLAUDE_MOCK=true` returns real fixture data so UI can be developed/demoed without API key
4. **Async analysis** — analysis runs in background, frontend polls every 2s until status changes
5. **Structured prompts** — prompts are built by `promptBuilder.ts`, never ad-hoc inline strings
6. **SQLite is sync** — all DB calls use `better-sqlite3` sync API; no async DB chaos

---

## Code Conventions

### Backend
- All routes return `{ error: string }` on failure with appropriate HTTP status
- Route handlers are thin — business logic goes in `/services/`
- Use `console.log('[module] message')` for logging, with module prefix
- Environment variables are read via `process.env.*` — never hardcoded
- Every DB query uses prepared statements (no string interpolation)

### Frontend
- Types live in `src/types/index.ts` — never define inline ad-hoc types
- API calls go through `src/services/api.ts` — no raw `fetch` or `axios` calls in components
- Tailwind classes used via component layer (`card`, `btn-primary`, etc.) where possible
- State: local `useState` — no global state manager yet (keep simple for MVP)
- Error and empty states are always handled — no unhandled loading states

---

## UI/UX Conventions

- **Color system**: purple-deep (`#3b0764`) is the primary brand color
- **Sidebar**: always visible, dark purple, fixed left
- **Cards**: use `.card` class — white bg, subtle border, light shadow
- **Badges**: `.badge-asis` (blue), `.badge-tobe` (violet), `.badge-screenshot` (slate)
- **Typography**: Inter font, `text-text-primary / text-text-secondary / text-text-muted`
- **Severity badges**: `.badge-high` (red), `.badge-medium` (amber), `.badge-low` (green)
- Never use raw Tailwind colours — use the design system tokens in `tailwind.config.js`
- Empty states must have an icon, heading, and CTA

---

## How to Add a New File Parser

1. Open `backend/src/services/fileParsing.ts`
2. Add a new `if` branch in `parseFile()` matching the MIME type or extension
3. Return extracted text as a string (capped at 100k chars recommended)
4. Add the new MIME type to the allowed list in `backend/src/routes/files.ts`
5. Update the `ACCEPTED` string in `frontend/src/components/FileUploader.tsx`

---

## How to Build Claude Prompts

All prompts go through `backend/src/services/promptBuilder.ts`.

Rules:
- Clearly separate **AS-IS** and **TO-BE** sections with markdown headers
- Always explicitly request: functional impacts, UI/UX impacts, business rules, prototypeHtml
- Always instruct Claude to return **only raw JSON** — no prose, no fences
- Cap extracted text at 30k chars per file in the prompt to stay within context limits
- Images are attached as base64 vision blocks **before** the text prompt
- Test prompt changes against mock mode first, then real API

The expected output schema is defined in `backend/src/types/index.ts` (`AnalysisResult`).

---

## How to Maintain As-Is / To-Be Separation

- On upload, users select: **As-Is**, **To-Be**, or **Screenshot**
- This is stored as `bucket` field in the `files` table
- `promptBuilder.ts` filters files by bucket and renders them in separate prompt sections
- Never mix as-is and to-be content in the same prompt section
- The frontend enforces this visually with colour-coded badges

---

## Key Files to Know

| File | Purpose |
|---|---|
| `backend/src/services/promptBuilder.ts` | All prompt construction |
| `backend/src/services/claude.ts` | Claude API client + response parser |
| `backend/src/services/mockAnalysis.ts` | Fixture data for mock mode |
| `backend/src/services/fileParsing.ts` | Text extraction per file type |
| `backend/src/db/index.ts` | SQLite init + schema |
| `frontend/src/services/api.ts` | All frontend API calls |
| `frontend/src/components/AnalysisTabs.tsx` | Main result UI |
| `frontend/src/components/PrototypePreview.tsx` | Iframe rendering of prototype HTML |

---

## Rules to Not Break the MVP

1. **Do not remove mock mode** — always keep `CLAUDE_MOCK` toggle working
2. **Do not change the AnalysisResult schema** without updating both `types/index.ts` files (backend + frontend) and `mockAnalysis.ts`
3. **Do not add external dependencies** to the frontend bundle without checking bundle size impact
4. **SQLite WAL mode** is enabled — do not disable foreign keys or WAL pragma
5. **Sanitize prototype HTML** with DOMPurify before rendering — never remove this
6. **File uploads** are stored in `backend/uploads/` — this is gitignored; don't commit files there

---

## Priority Evolutions (in order)

1. Streaming Claude responses (show tokens as they arrive)
2. Export analysis to PDF
3. Auth layer (single-user JWT or Clerk)
4. Multi-project comparison view
5. Jira/ADO integration to create tickets from impacts
6. Embedding-based document retrieval (RAG) for large document sets
7. PostgreSQL migration for multi-user production
