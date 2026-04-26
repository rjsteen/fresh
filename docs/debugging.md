# Debugging guide

Quick reference for diagnosing issues with the local dev stack.

---

## Logs

```sh
# Stream all backend logs
docker compose logs -f backend

# Last 50 lines then follow
docker compose logs -f --tail=50 backend

# Requests only
docker compose logs -f backend | grep -E "GET|POST|PUT|PATCH|DELETE"

# Errors and warnings only
docker compose logs -f backend | grep -E "\[error\]|\[warning\]"

# Postgres logs
docker compose logs -f postgres
```

---

## Container status

```sh
# Are containers running and healthy?
docker compose ps

# Why did a container exit?
docker compose logs backend --tail=50
```

---

## Database

```sh
# Open a psql shell
docker compose exec postgres psql -U postgres -d finapp_dev

# Quick connection check from the backend container
docker compose exec backend iex -S mix -e "Finapp.Repo.query!(\"SELECT 1\")"

# Check current pool size config
docker compose exec backend iex -S mix
iex> Finapp.Repo.config() |> Keyword.get(:pool_size)

# Check active Postgres connections (run inside psql)
SELECT count(*), state FROM pg_stat_activity WHERE datname = 'finapp_dev' GROUP BY state;

# Kill idle connections (if pool exhaustion persists after restart)
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname = 'finapp_dev' AND state = 'idle' AND pid <> pg_backend_pid();
```

**Pool exhaustion** (`connection not available and request was dropped from queue`):
- `POOL_SIZE` in `docker-compose.yml` must exceed the sum of all Oban queue limits
  (`bank_sync: 10` + `notifications: 20` + `model_dist: 2` = 32 minimum)
- Postgres `max_connections` default is 100 — check with `SHOW max_connections;` in psql
- If `DATABASE_URL` hostname is wrong (e.g. `localhost` inside a container), Postgrex
  queues retries until the 317ms window expires, which looks identical to pool exhaustion

---

## CORS

```sh
# Test a preflight from the browser's origin
curl -sv -X OPTIONS http://localhost:4000/api/v1/auth/register \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" \
  2>&1 | grep -E "< HTTP|Access-Control"
```

Expected: `HTTP/1.1 200` with `access-control-allow-origin: http://localhost:5173`.

**`net::ERR_CONNECTION_RESET`** on requests from the browser:
- Phoenix is bound to `127.0.0.1` (container loopback) instead of `0.0.0.0`
- Fix: ensure `PORT` env var is set in `docker-compose.yml` — `runtime.exs` uses it
  to override the bind address to `0.0.0.0`

**`Failed to fetch` / CORS preflight 404**:
- Corsica must be in `endpoint.ex`, not inside a router pipeline
- Pipeline plugs only run after a route is matched; OPTIONS requests don't match
  any `post`/`delete`/etc. route, so they 404 before Corsica runs

---

## Phoenix

```sh
# IEx console against the running container
docker compose exec backend iex -S mix

# Run migrations manually
docker compose exec backend mix ecto.migrate

# Reset the dev database (drop + recreate + migrate + seed)
docker compose exec backend mix ecto.reset

# Check registered routes
docker compose exec backend mix phx.routes

# Inspect Oban job queue
iex> Oban.check_queue(queue: :bank_sync)
iex> Oban.check_queue(queue: :notifications)

# Drain a queue synchronously (useful in dev to force jobs to run)
iex> Oban.drain_queue(queue: :bank_sync)
```

---

## Running tests

```sh
# Infrastructure must be up before mix test
docker compose up -d --wait postgres redis

cd apps/backend
mix test                                      # full suite
mix test test/finapp_web/cors_test.exs        # CORS only (no DB needed)
mix test test/finapp_web/controllers/         # controllers only

# Or use the repo script (starts containers automatically)
bin/test --backend
```

---

## SimpleFIN sync

```sh
# Check recent sync job errors
docker exec privacyfinance-backend-1 mix run --eval '
import Ecto.Query
Finapp.Repo.one(from j in Oban.Job,
  where: j.worker == "Finapp.Sync.BankSyncWorker",
  order_by: [desc: j.inserted_at], limit: 1)
|> Map.take([:state, :attempt, :errors])
|> IO.inspect()'

# Retry the last discarded BankSyncWorker job
docker exec privacyfinance-backend-1 mix run --eval '
import Ecto.Query
job = Finapp.Repo.one(from j in Oban.Job,
  where: j.worker == "Finapp.Sync.BankSyncWorker",
  order_by: [desc: j.inserted_at], limit: 1)
Oban.retry_job(job.id)'

# Test SimpleFIN fetch directly without going through Oban
docker exec privacyfinance-backend-1 mix run --eval '
job = Finapp.Repo.one(Finapp.Sync.SyncJob)
Finapp.Sync.SimpleFin.fetch_transactions(job) |> IO.inspect()'

# Inspect the stored access URL (useful for diagnosing 404/403)
docker exec privacyfinance-backend-1 mix run --eval '
job = Finapp.Repo.one(Finapp.Sync.SyncJob)
{:ok, url} = Finapp.Vault.decrypt(job.encrypted_access_url_ref)
IO.puts(url)'

# Delete all sync jobs and reconnect from scratch
docker exec privacyfinance-backend-1 mix run --eval \
  'Finapp.Repo.delete_all(Finapp.Sync.SyncJob)'
```

**SimpleFIN setup tokens are one-time use.** If a claim fails or the stored
access URL returns 403, you must delete the sync job, generate a fresh token at
bridge.simplefin.org, and paste it in the UI.

**Code changes not taking effect in background workers:**
Phoenix hot-reload only applies to web request handlers. Oban workers run in the
persistent `phx.server` process and won't pick up changes until it restarts.
Force a recompile then restart:

```sh
docker exec privacyfinance-backend-1 mix compile --force
docker compose restart backend
```

---

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `ERR_CONNECTION_RESET` | Phoenix bound to `127.0.0.1` in Docker | Set `PORT` env var; `runtime.exs` overrides to `0.0.0.0` |
| `Failed to fetch` (CORS) | OPTIONS preflight hits 404 | Corsica must be in `endpoint.ex`, not router pipeline |
| Pool exhaustion (317ms drop) | `POOL_SIZE` < Oban queue limits | Set `POOL_SIZE` ≥ 40 in `docker-compose.yml` |
| `connection refused` on `mix test` | Postgres not running | `docker compose up -d --wait postgres redis` |
| `hostname not found: postgres` | Running `mix test` locally with Docker hostname | Use `localhost` not `postgres` — `dev.exs` handles local, `runtime.exs` handles Docker |
