# PrivacyFinance — Claude Code guidelines

## Repo layout

```
apps/
  web/        React + Vite (TypeScript, styled-components, sql.js, Recharts)
  backend/    Phoenix (Elixir) — sync orchestration, push signals, no financial data
  mobile/     React Native / Expo
sidecar/      Python ML service
packages/
  core/       Shared TypeScript — SQLite schema, queries, budget engine, ML helpers
  ui/         Shared React component library
```

---

## Before finishing any task

Run the checks below that are relevant to the files you changed.
**Do not mark a task complete or propose a PR if any check is failing.**

### Frontend / TypeScript (apps/web, packages/core, packages/ui)

```bash
# From repo root — runs across all TS packages via Turborepo
pnpm turbo type-check
pnpm turbo lint
pnpm turbo test

# Or scoped to a single package while iterating
pnpm --filter @fresh/web type-check
pnpm --filter @fresh/web lint
pnpm --filter @fresh/web test

pnpm --filter @fresh/core type-check
pnpm --filter @fresh/core lint
```

All three must pass — zero type errors, zero lint errors, zero failing tests.

### Backend (apps/backend — Elixir/Phoenix)

**Prerequisite:** postgres and redis must be running before `mix test`.
The quickest way to ensure this:

```bash
docker compose up -d --wait postgres redis
```

Then:

```bash
cd apps/backend

mix credo --strict   # lint
mix test             # unit + integration tests (auto-migrates test DB)
```

Both must pass before any backend change is considered done.

### Running everything at once

```bash
bin/test             # starts containers if needed, then runs backend + frontend checks
bin/test --backend   # backend only
bin/test --frontend  # frontend only
```

---

## Writing tests

### Frontend
- Tests live alongside source files as `*.test.tsx` / `*.test.ts`.
- Use **Vitest** + **React Testing Library**.
- Use `src/test/makeTestDb.ts` to get a real in-memory sql.js database with the
  full schema applied — **do not mock `db.raw.query` or `db.raw.execute`**.
  SQL bugs, schema constraint issues, and migration regressions must be caught
  by hitting real SQLite.
- Only mock things that can't run in jsdom: `useDb` (swap in a real DbClient),
  browser APIs with no jsdom equivalent (`ResizeObserver`, OPFS, etc.).
- Assert on observable DB state (query the DB after mutations) rather than on
  mock call args.

### Backend
- Tests live in `apps/backend/test/`.
- Use `FinappWeb.ConnCase` for any test that touches the database or HTTP stack.
  It automatically checks out an `Ecto.Adapters.SQL.Sandbox` connection and
  rolls back after each test — no manual cleanup needed.
- **Never mock `Repo` or Ecto queries.** Insert seed data with `Repo.insert/2`,
  `Repo.insert_all/2`, or changesets, then assert by querying the real DB (e.g.
  `Repo.one(from ...)`, `Repo.all(...)`). The sandbox is the isolation boundary.
- **The only acceptable mock target is external HTTP.** Use `Req.Test.stub/2`
  to intercept outbound HTTP calls (SimpleFIN, GoCardless, etc.) — stub the
  network boundary, not business logic. Every other dependency must be real.
- Assert on DB state after mutations, not on whether a function was called.
  For example: after a controller writes a row, verify the row exists in the DB
  with the expected values.
- The `mix test` alias handles DB creation and migration automatically.

---

## Key architectural rules

- **No financial data on the server.** All transactions, budgets, accounts, and
  categories live exclusively in the on-device SQLite database (sql.js in web,
  Expo SQLite in mobile). The backend stores only opaque sync tokens and push
  signal references.
- **Foreign key enforcement.** The SQLite driver sets `PRAGMA foreign_keys = ON`
  on every connection. ON DELETE CASCADE on `budget_lines`, `transactions`, etc.
  depends on this — do not remove it.
- **Schema changes** go in `packages/core/src/db/schema.ts` as a new numbered
  migration in the `MIGRATIONS` map. Never edit existing migration entries.
- **Shared query logic** belongs in `packages/core/src/db/queries.ts`, not
  duplicated in individual apps.
