# WatchMe shared host — live verification (2026-05-01)

SSH session succeeded from operator workstation after `ssh-agent` + key load. Host: **WatchMe-vps** (`139.59.184.74`), Ubuntu 24.04.

## 1. Source-of-truth layout

| Role | Path | Notes |
|------|------|--------|
|Pro V2 API + worker | `/opt/watchme-v2` | `run-api.sh` / `run-worker.sh` source `.env` |
|Website “main” (port 3002) | `/srv/watchme-site` or related | `watchme-web` PM2, path from `ss` |
|Website V2 API | `/opt/watchme-web-v2` | PM2 `watchme-web-v2-api`, port **3103** |
|Lite V2 | `/opt/lite-v2` | PM2 `watchme-lite-v2` |
|Archives / legacy | `/opt/watchme-archive`, `/opt/watchme-bot`, `/opt/watchme-lite` | Not primary |

`/root/.env` exists (root-level; treat as non-canonical unless documented).

## 2. Process supervision (PM2)

**Online:** `watchme-v2-api`, `watchme-v2-worker`, `watchme-v2-pager`, `watchme-web` (3002), `watchme-web-v2-api` (3103), `watchme-lite-v2`.

**Stopped:** `watchme`, `watchme-lite` (legacy names; confirm intentional).

**Note:** `watchme-lite-v2` shows **150** historical restarts (high churn). Worth tailing error logs when convenient.

## 3. Ports / routing

| Port | Process |
|------|---------|
| 3101 | Pro V2 API |
| 3102 | Pro V2 worker |
| 3103 | Web V2 API |
| 3002 | Legacy/main website API |
| 80/443 | Caddy |

**Caddy (`/etc/caddy/Caddyfile`):**

- `watchme-bot.com`: `/api/health`, `/health`, dashboard/billing/auth paths → **3002**; other `/api/*`, `/facebook/*` → **3101**; default → 3002.
- `pro.watchme-bot.com`: webhook paths → **3102**; default → **3101**.
- `lite.watchme-bot.com` → **3000**.

## 4. Quick health (validated)

- `http://127.0.0.1:3101/api/health` → `{"ok":true,"service":"watchme-v2-api"}`
- `http://127.0.0.1:3103/api/health` → production web-v2-api OK
- `http://127.0.0.1:3102/ops/runtime` without token → **401/Unauthorized** (expected fail-closed behavior)
- Public: `https://pro.watchme-bot.com/api/health` → Pro API OK
- Public: `https://watchme-bot.com/api/health` → `watchme-web` OK, **Postgres** for state + sessions

## 5. PostgreSQL

`postgresql.service` is **active**. DB listens on **127.0.0.1:5432**.

## 6. Environment / drift vs hardened checklist

**File `/opt/watchme-v2/.env` (names only):** `NODE_ENV`, `DATABASE_URL`, `INTERNAL_API_TOKEN`, `SESSION_SECRET`, `TWITCH_WEBHOOK_SECRET`, `YOUTUBE_WEBHOOK_PATH` → **present**.

**Missing from that file (grep):** `MOBILE_SESSION_SECRET`, `MOBILE_API_WRITE_TOKEN`, `PAYPAL_WEBHOOK_ID`, `PRO_BOT_BASE_URL`. If production mobile or PayPal-on-Pro is required, add explicit values; avoid collapsing everything into `SESSION_SECRET`.

**`/opt/watchme-web-v2/.env`:** file exists; several keys expected for full website hardening were **not** present in the file via the same grep (e.g. `DATABASE_URL`, `SESSION_SECRET`, PayPal keys, `PRO_BOT_BASE_URL`). Runtime still reports production — config may be coming from **PM2 env** or other inject. **Reconcile** file vs PM2 so production is explicit and repeatable.

**Operator action:** Ensure `WEB_V2_SESSION_SECRET` (and any other secrets) in PM2 are **strong, unique**, and not placeholders; avoid committing `pm2 save` dumps with literals to repos.

## 7. Exit criteria (checklist §10)

| # | Status |
|---|--------|
| Deployed paths known | Yes (table above) |
| Runtime ownership known | PM2 / root, Caddy edge |
| Secret split / env hygiene | Partial — gaps above |
| DB / backups | Postgres up; backup drill not run in this pass |
| Reverse proxy / routing | Caddyfile reviewed; matches Pro v2 cutover |
| Launch blockers | Mobile/PayPal/env parity on server **open** until vars aligned; Lite v2 restart count **watch** |

## 8. Suggested follow-ups

1. **Deploy current `pro.v2` from this monorepo** — live `/opt/watchme-v2/apps/api/src/config.js` was shorter than repo (no `validateApiConfig` in the audited build). After pull, **`npm run check`** with sourced `.env` must pass; boot-time validation is enabled in repo so missing prod keys will stop the process.
2. Add **`PUBLIC_API_WRITE_TOKEN`**, **`LITE_API_WRITE_TOKEN`**, **`MOBILE_SESSION_SECRET`**, **`MOBILE_SESSION_REQUIRED=true`** to `/opt/watchme-v2/.env` (they were absent from the key list on 2026-05-01).
3. Align `watchme-web-v2` env: single source of truth (`.env` vs PM2 ecosystem); rotate weak `WEB_V2_SESSION_SECRET` if applicable.
4. Inspect `pm2 logs watchme-lite-v2 --lines 200` if restart count grows again (Discord reconnect churn was visible in logs).
5. Remove or document stopped PM2 apps `watchme` / `watchme-lite`.
6. Follow **`_docs/WATCHME-PRE-LAUNCH-RUNBOOK.md`** for a full launch gate and systems test matrix.
