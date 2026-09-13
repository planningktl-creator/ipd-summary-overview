# Deployment runbook

## Local Docker

1. Copy `.env.example` to `.env` and generate three different long random secrets.
2. Keep `APP_MODE=demo` until BMS platform, DBA and data-owner sign-off is complete.
3. Build and start:

```powershell
docker compose config
docker compose build
docker compose up -d
docker compose run --rm api node scripts/migrate.mjs
```

4. Check `http://localhost:3082/healthz` and `docker compose ps`.
5. Stop with `docker compose down`; retain the named Postgres volume only when the local audit state is intentionally needed.

The web service exposes `3082:8080`; API `8788` is internal to Compose. Containers are non-root, read-only, capability-dropped and have no-new-privileges enabled.

## BMS Marketplace

1. Register the app in the BMS Marketplace and obtain a staging session flow. Do not place the session code or marketplace token in source, URL bookmarks, screenshots or issues.
2. Set `APP_MODE=bms`, `BMS_MARKETPLACE_TOKEN`, BMS allow-list and production secrets in the platform secret store. Use HTTPS at the edge so the cookie remains `Secure`.
3. Run migrations against the app-owned PostgreSQL database from a controlled release job.
4. Send a fresh session code to `POST /api/session/handshake`; verify `/api/session` returns only status/actor metadata and never token material.
5. Verify `/api/cases` with a staging account and review query latency/cardinality. Confirm HOSxP remains read-only and no write query is enabled.
6. Run browser smoke: no PHI/token in browser storage, URL, console or request log; verify image endpoint authorization and Markdown sanitizer.
7. Run DRG evidence gates with a synthetic/anonymized case before opening the environment to auditors.

## Rollback

- stop routing new traffic to the release, keep audit database immutable/readable
- revoke the BMS session at the platform boundary and rotate compromised secrets
- deploy the last verified image tag; do not reset or delete the audit database as a rollback shortcut
- preserve correlation IDs and deployment metadata for the incident timeline

## Operations

Health endpoints: `/healthz` is process-level; `/readyz` additionally checks PostgreSQL. Logs must be structured and must not contain SQL, raw query responses, HN, names, tokens or cookies. The documented p95 values are release baselines only.
