# WatchMe pre-launch runbook

Use this to close env drift, deploy current code, and run a single systems test pass before public launch. Pair with:

- `_docs/WATCHME-SHARED-HOST-SSH-CHECKLIST.md` (discovery)
- `_docs/WATCHME-LIVE-VERIFICATION-2026-05-01.md` (last known host snapshot)
- `pro.v2/docs/vps-deploy.md` (Pro deploy mechanics)

## Phase A — Code sync (VPS)

On the host (`WatchMe-vps`), for each deploy root:

| Path | Repo / role |
|------|-------------|
| `/opt/watchme-v2` | `pro.v2` — API 3101, worker 3102 |
| `/srv/...` (or PM2 `cwd` for `watchme-web`) | `webpage watchme` — main site API 3002 |
| `/opt/watchme-web-v2` | `webpage.v2` — Web V2 API 3103 |
| `/opt/lite-v2` | `lite.v2` — Lite Discord bot |

Typical flow (Pro example):

```bash
cd /opt/watchme-v2
git pull   # or rsync from your release artifact
npm ci --omit=dev   # or keep dev on staging only
```

**Important:** A live audit showed `/opt/watchme-v2/apps/api/src/config.js` was **older** than this monorepo (no `validateApiConfig`). After you pull current `pro.v2`, **API and worker validate config on every boot** — incomplete production env will prevent startup until fixed (see Phase B).

---

## Phase B — Pro V2 environment (`/opt/watchme-v2/.env`)

### B1 — Required when `NODE_ENV=production` (API)

These are enforced by `validateApiConfig` after deploying current code:

| Variable | Notes |
|---------|--------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgres://` or `postgresql://` |
| `INTERNAL_API_TOKEN` | Dedicated secret; do not reuse in URLs |
| `PUBLIC_API_WRITE_TOKEN` | Dedicated secret for public write routes |
| `LITE_API_WRITE_TOKEN` | Dedicated secret for Lite → Pro calls |
| `MOBILE_SESSION_SECRET` | Dedicated secret for signed mobile sessions (not optional in prod) |
| `MOBILE_SESSION_REQUIRED` | Must be **enabled** (e.g. `true`) |

### B2 — Strongly recommended (Android / parity)

| Variable | Notes |
|---------|--------|
| `MOBILE_API_WRITE_TOKEN` | Dedicated token for mobile write routes (avoid `SESSION_SECRET` fallback) |

### B3 — Worker (same `.env` when using `run-worker.sh`)

Enforced by `validateWorkerConfig`:

| Variable | Notes |
|---------|--------|
| `DATABASE_URL` | Same DB |
| `INTERNAL_API_TOKEN` | Same as API |
| `DISCORD_BOT_TOKEN` | **or** `DISCORD_TOKEN` (worker accepts both) |
| `TWITCH_WEBHOOK_SECRET` | If `TWITCH_WEBHOOK_BASE_URL` is set |
| `YOUTUBE_WEBHOOK_PATH` | If YouTube webhooks are enabled in prod, path must **not** stay default `/webhooks/youtube` |

### B4 — Verify before restart

```bash
cd /opt/watchme-v2
set -a && . ./.env && set +a
npm run check
```

Exit code **0** required. Then:

```bash
pm2 restart watchme-v2-api watchme-v2-worker watchme-v2-pager
pm2 logs watchme-v2-api --lines 50 --nostream
```

**Current host gap (2026-05-01):** `.env` listed `INTERNAL_API_TOKEN`, `SESSION_SECRET`, etc., but **did not** list `PUBLIC_API_WRITE_TOKEN`, `LITE_API_WRITE_TOKEN`, `MOBILE_SESSION_SECRET`, or `MOBILE_SESSION_REQUIRED`. Generating these and appending **before** deploying latest `pro.v2` avoids a surprise boot loop.

---

## Phase C — Main website (`watchme-web`, port 3002)

Production stack is `webpage watchme` (Express + Postgres sessions). Follow `webpage watchme/.env.example` and `lib/startup-validation.js` rules:

- `DATABASE_URL` (Postgres), `SESSION_SECRET`, `PRO_BOT_BASE_URL`, Discord OAuth set, PayPal set if billing is live, `CANONICAL_PUBLIC_HOST`, `NODE_ENV=production`.

Confirm health:

```bash
curl -sS https://watchme-bot.com/api/health
```

Expect `storage.sessions` / `state` indicating **postgres** in production.

---

## Phase D — Web V2 API (`watchme-web-v2-api`, port 3103)

Config uses **`WEB_V2_*`** names (see `webpage.v2/.env.example`). Minimum for production:

- `NODE_ENV=production`
- `WEB_V2_API_PORT=3103` (match Caddy / PM2)
- `WEB_V2_SESSION_SECRET` — **long random**; rotate if ever logged or committed
- `WEB_V2_PUBLIC_ORIGIN`, `WEB_V2_ALLOWED_ORIGINS` — production site origins
- Discord OAuth fields if `/auth` is used
- `WEB_V2_PRO_V2_API_BASE_URL` (e.g. `http://127.0.0.1:3101`) and `WEB_V2_PRO_V2_API_TOKEN` (e.g. `INTERNAL_API_TOKEN` or scoped token)

**Single source of truth:** Prefer `.env` in `/opt/watchme-web-v2` **and** paste the same values into `ecosystem.config.cjs` (or drop PM2 `env` blocks and rely on `dotenv` + `cwd`). Avoid secrets only in `pm2 save` dumps without a file backup.

```bash
curl -sS http://127.0.0.1:3103/api/health
```

---

## Phase E — Lite V2 (`/opt/lite-v2`)

- `LITE_DISCORD_TOKEN` / token, `LITE_API_BASE_URL` (Pro API URL), `LITE_API_WRITE_TOKEN` (must match Pro `LITE_API_WRITE_TOKEN`)

Logs showed repeated “bootstrap ready” (Discord reconnects); **high restart count** may be normal during discord.js reconnect storms. After deploy:

```bash
pm2 logs watchme-lite-v2 --lines 100 --nostream
```

Confirm stable “logged in” and `/wme` registration.

---

## Phase F — PM2 hygiene

1. **Remove or document** stopped processes: `watchme`, `watchme-lite` — if obsolete: `pm2 delete <name>`.
2. After changes: `pm2 save`.
3. Optional: `pm2 startup` idempotency check after reboot.

---

## Phase G — Caddy

Validate `/etc/caddy/Caddyfile` still matches:

- `watchme-bot.com` — dashboard/auth/billing paths → `3002`; other `/api/*` → `3101` per cutover.
- `pro.watchme-bot.com` — webhooks → `3102`; default → `3101`.
- `lite.watchme-bot.com` → Lite (port in your file).

Reload after edits:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

---

## Phase H — Backups

1. Confirm `pg_dump` (or your automation) runs on a schedule; artifact off-box.
2. Quarterly: restore drill to a **non-production** database (see `pro.v2` package scripts if `pg:restore-drill` is configured).

---

## Phase I — Systems test checklist (launch gate)

Run from your workstation (replace hosts if different). Record **Pass/Fail** and notes.

### I1 — Edge HTTP

| Check | Command / action | Expected |
|-------|------------------|----------|
| Pro API | `curl -sS https://pro.watchme-bot.com/api/health` | JSON `ok`, `watchme-v2-api` |
| Main site API | `curl -sS https://watchme-bot.com/api/health` | JSON `ok`, postgres-backed summary |
| Web V2 API | `curl -sS http://127.0.0.1:3103/api/health` **on VPS** or via tunnel | `watchme-web-v2-api`, `env` production |
| Worker fail-closed | On VPS: `curl -sS http://127.0.0.1:3102/ops/runtime` (**no** `Authorization` header) | 401/403 (not 200 with body) |

### I2 — Worker ops (on VPS)

With `INTERNAL_API_TOKEN` (worker `Authorization: Bearer` or project-specific header — use same as your internal ops clients):

| Check | Expected |
|-------|----------|
| `curl -sS -H "Authorization: Bearer <INTERNAL_API_TOKEN>" http://127.0.0.1:3102/ops/runtime` | 200 + runtime JSON |

### I3 — Discord / OAuth smoke

| Check | Expected |
|-------|----------|
| Lite bot online in Discord | Presence + `/wme` responds in test guild |
| Website login | OAuth completes; session cookie set (HTTPS) |

### I4 — Billing (if live)

| Check | Expected |
|-------|----------|
| PayPal webhook | Dashboard/web logs show verified events; no fail-open on missing `PAYPAL_WEBHOOK_ID` on website stack |
| Plan purchase flow | Test in sandbox or low-risk tier first |

### I5 — Mobile (if live)

| Check | Expected |
|-------|----------|
| App against prod API | Creator routes require session when `MOBILE_SESSION_REQUIRED=true` |
| Push registration | Release build uses real FCM + API base URL |

### I6 — Post-reboot (optional)

| Check | Expected |
|-------|----------|
| `reboot` during maintenance window | PM2 resurrect or systemd brings all apps; health endpoints green within 5 minutes |

---

## Launch sign-off

- [ ] Phase B `npm run check` passes on VPS with **sourced** `.env`
- [ ] All Phase I1 checks pass
- [ ] Discord + website login smoke pass (I3)
- [ ] Billing path verified or explicitly disabled for launch (I4)
- [ ] Backup job confirmed for next run window (H)
- [ ] On-call knows PM2 names and log paths (`/root/.pm2/logs/`)
