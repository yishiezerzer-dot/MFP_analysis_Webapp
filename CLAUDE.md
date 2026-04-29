# MFP Analysis App — Lab Data Analysis Webapp

Full-stack scientific analysis tool: React 18 + TypeScript frontend, Python FastAPI backend.
Five analysis modules: LCMS, FTIR, Plate Reader, Data Studio, AI Assistant.

## Repository Layout

MFP_analysis_app/web/
├── frontend/                   # React 18 + TypeScript + Vite + Tailwind
│   └── src/
│       ├── views/              # Five tab views (LCMS, FTIR, PlateReader, DataStudio, AI)
│       ├── components/         # Shared UI (EmptyState, Tooltip, Toast, SectionDivider)
│       ├── layout/             # PageHeader, UserMenu
│       ├── store/              # RTK slices + store (create here when needed)
│       ├── theme/              # ThemeProvider
│       └── api.ts              # Typed fetch wrapper — all backend calls go through here
└── backend/
    └── app/
        ├── routers/            # One router per module (lcms, ftir, plate_reader, data_studio, ai)
        └── services/           # Business logic per module

## Dev Commands

Frontend dev server:   cd MFP_analysis_app/web/frontend && npm run dev
Frontend type check:   cd MFP_analysis_app/web/frontend && npm run lint
Frontend build:        cd MFP_analysis_app/web/frontend && npm run build
Backend dev server:    cd MFP_analysis_app/web/backend && uvicorn app.main:app --reload --port 8000

Frontend runs on http://127.0.0.1:5173. All /api/* calls proxy to http://127.0.0.1:8000.
No testing framework is installed yet — type-check (npm run lint) is the verification step.

## State Management — Redux Toolkit (RTK)

@reduxjs/toolkit and react-redux are installed but the store is NOT yet wired up.
When a feature first needs shared state, bootstrap it:
  1. Create src/store/store.ts with configureStore
  2. Create src/store/hooks.ts with typed useAppSelector / useAppDispatch
  3. Add <Provider store={store}> in src/main.tsx (wraps ToastProvider)

Rules:
- Shared / cross-view state → RTK slice in src/store/
- New API integration → RTK Query (createApi), not raw fetch
- Local UI-only state (hover, open/closed, single component) → useState is fine

## Design System

Three themes: day / night / night-vision — toggled via data-theme on <html>.
Tokens: --ink-1 through --ink-6, --brand-500, --canvas, --surface, --surface-raised.

Typography classes: .text-heading  .text-body  .text-caption  .text-mono-val
Button classes:     .btn-primary   .btn        .btn-danger     .btn-ghost
All charts: Plotly via react-plotly.js. Use theme tokens in layout.paper_bgcolor / plot_bgcolor.

## TypeScript / React Conventions

- Strict mode is on — never use `any`; prefer `unknown` + type narrowing or explicit types
- Named exports only; no default exports (except lazy route imports)
- Functional components + hooks only; no class components
- Props as inline interface, colocated with the component
- clsx() for conditional classNames (already installed)
- No comments unless the WHY is non-obvious; no multi-line docstrings

## Backend Conventions

- No backend changes unless explicitly requested
- One router per module in app/routers/; business logic in app/services/
- Async/await for all I/O; return Pydantic models from endpoints

## Do NOT

- Do not use raw fetch() for new API calls — use the existing api.ts wrapper or RTK Query
- Do not make backend changes for frontend-only improvements
- Do not create a new file when editing an existing one suffices
- Do not add backwards-compatibility shims for removed code
- Do not hardcode secrets — use environment variables
