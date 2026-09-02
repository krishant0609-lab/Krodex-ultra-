# KRODEX

A learning system. Engineered in phases per the documented vision.

> **Status:** Phase 0 — Repository & Environment Foundation.
> No application features are implemented yet. Domain work begins in Phase 1.

---

## Workspace layout

```
krodex/
├── apps/
│   ├── api/          # Node.js + Fastify 4.21+ (Phase 0: /health only)
│   └── web/          # Next.js 14 App Router (Phase 0: foundation page only)
├── packages/
│   └── shared/       # Cross-app TypeScript types and contracts
├── supabase/         # Local Supabase config (created by `npx supabase init`)
├── .env.example      # Environment variable template (placeholders only)
├── .eslintrc.cjs     # Root ESLint config
├── .prettierrc       # Prettier config
├── .editorconfig     # Whitespace + line ending baseline
├── .gitignore
├── package.json      # npm workspaces root
└── README.md
```

## Requirements

- **Node.js** ≥ 20 (we develop on 24.x; ≥ 20 is the supported floor)
- **npm** ≥ 10
- **Git** (for version control)
- **Supabase CLI** — invoked via `npx supabase …`; no global install required

## Getting started

```bash
# 1. Install dependencies (resolves the npm workspaces)
npm install

# 2. Copy the env template (do NOT commit a real .env)
cp .env.example .env

# 3. Type-check every workspace
npm run typecheck

# 4. Lint
npm run lint

# 5. Build everything
npm run build

# 6. Run both services in parallel
npm run dev
```

The API will listen on `http://127.0.0.1:3001` and expose `GET /health`.
The web app will serve on `http://localhost:3000`.

## Available scripts

| Script                | Purpose                                                     |
| --------------------- | ----------------------------------------------------------- |
| `npm run dev`         | Run API + Web in parallel (hot-reload)                      |
| `npm run dev:api`     | Run API only                                                |
| `npm run dev:web`     | Run Web only                                                |
| `npm run build`       | Build shared, API, and Web                                  |
| `npm run typecheck`   | TypeScript check across all workspaces                      |
| `npm run lint`        | ESLint across the repo                                      |
| `npm run format`      | Prettier write                                              |
| `npm run format:check`| Prettier check (CI)                                         |
| `npm run clean`       | Remove `dist/`, `.next/`, `.turbo/`, `*.tsbuildinfo`        |

## Supabase

Phase 0 only initializes the local config. To actually start a local Postgres
+ Auth + Storage stack:

```bash
npx supabase start         # boots the local stack (requires Docker)
npx supabase stop          # stops it
npx supabase status        # shows running services
```

If you do not have Docker available, you can defer the local stack until
Phase 1.

## Project phases

This repository is built strictly in dependency order. Do not skip ahead.

- **Phase 0** — Repository & environment foundation _(this phase)_
- **Phase 1** — Core data model + persistence
- **Phase 2** — Domain services + API contracts
- **Phase 3** — Event-driven connective layer
- **Phase 4** — Analytics / progress engine
- **Phase 5** — Student behavior model
- **Phase 6** — Frontend architecture + real data integration
- **Phase 7** — UI/UX implementation
- **Phase 8** — AI layer
- **Final** — Capture/evidence, review/retest, planner/backlog automation,
  notifications, E2E verification, security hardening, performance,
  production readiness

## Engineering principles

This project follows a strict engineering loop. The UI is always a
truthful projection of the system — never a simulation. Real input,
real domain logic, real persistence, real events, real downstream
effects, real UI reflection, tested failure paths.

See the documentation set in the project root (PDFs) for the full
source of truth.
