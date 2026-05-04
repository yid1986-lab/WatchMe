# Pro V2 — VPS deployment (when you add a dedicated server)

This guide is for the **Pro stack** (API + worker + pager + Postgres as documented). **Lite V2** (`apps/lite-v2`) is a **separate** product and may use **different** hosting and cutover timing when you replace Lite V1.

**Operator plan (Pro only):** provision this **dedicated Pro V2 VPS** when **Pro V1 is around ~30 Discord guilds**, then **test Pro V2 there until Pro V1 is around ~50 guilds** before **Pro V1 → Pro V2 cutover** (see `docs/cursor-pro-handoff.md` — *Rollout gates*).

Until gate A, work **locally** only if you prefer; this doc is the checklist for a **clean first install** on its own Linux VPS (Ubuntu/Debian-style commands). Adjust paths and users to match your host.

**Shared production host:** after install, use the monorepo **`_docs/WATCHME-PRE-LAUNCH-RUNBOOK.md`** for env parity, `npm run check`, and the launch systems-test matrix.

## What you need on the server

- **Node.js** 20 LTS (or 18+; see `package.json` `engines` and root `.nvmrc`).
- **PostgreSQL** 16 (recommended; match `infra/docker-compose.yml` major version if possible).
- **PostgreSQL client tools** (`pg_dump`, `pg_restore`) for backups — package `postgresql-client` on Debian/Ubuntu.
- **Git** (or rsync/scp deploy from your machine).
- A non-root **deploy user** (example below: `watchme`).
- **Firewall** — only open what you use (SSH, HTTPS, and optionally app ports during bring-up).

## Local-first (before ~30 Pro V1 guilds)

- Develop and run smokes/stress on your PC with Docker Postgres or local Postgres (`docs/validation-and-soak.md`).
- No **dedicated Pro V2 VPS** is required until the **~30 Pro V1 guild** gate; after that, use this doc on the new server for **Pro V2 testing** while **Pro V1 stays live** until the **~50 Pro V1 guild** cutover decision.

## 1. Create OS user and app directory

```bash
sudo adduser --disabled-password --gecos "" watchme
sudo mkdir -p /opt/watchme-v2
sudo chown watchme:watchme /opt/watchme-v2
```

Deploy the repo here (as `watchme`):

```bash
sudo -u watchme -H bash -c 'cd /opt/watchme-v2 && git clone <YOUR_REPO_URL> .'
```

Or upload a tarball/rsync from your machine into `/opt/watchme-v2`.

## 2. Install Node dependencies

```bash
cd /opt/watchme-v2
npm install
```

Use the same Node major as local (see `.nvmrc`). On the VPS, install Node via NodeSource, nvm, or distro packages.

## 3. PostgreSQL

Create role and database (names can match `.env.example`):

```bash
sudo -u postgres psql -c "CREATE USER watchme WITH PASSWORD 'choose-a-strong-password';"
sudo -u postgres psql -c "CREATE DATABASE watchme_v2 OWNER watchme;"
```

Apply the **canonical schema** once (idempotent `CREATE IF NOT EXISTS`):

```bash
sudo -u postgres psql -d watchme_v2 -f /opt/watchme-v2/infra/postgres/schema.sql
```

Some tables are also created lazily when the API/worker first run (e.g. pager, worker heartbeats). The base schema file is still the source of truth for a fresh VPS.

Set:

```text
DATABASE_URL=postgres://watchme:PASSWORD@127.0.0.1:5432/watchme_v2
```

## 4. Environment files (production)

Copy from `.env.example` and fill values. **Do not commit real secrets.**

Recommended layout on the VPS (permissions `chmod 600`):

| File | Used by |
|------|---------|
| `/etc/watchme-v2/api.env` | API systemd unit |
| `/etc/watchme-v2/worker.env` | Worker systemd unit |
| `/etc/watchme-v2/pager.env` | Pager systemd unit |
| `/etc/watchme-v2/backup.env` | Postgres backup unit |

Minimum overlap:

- **`DATABASE_URL`** — same DB in all three app env files.
- **`INTERNAL_API_TOKEN`** — **same random value** in API, worker, and pager (pager calls internal routes).
- **`NODE_ENV=production`** for API and worker when you are live.
- **Discord / Twitch / YouTube / Kick / Meta** — set per connector as you enable them.
- **Webhook base URLs** — must be **`https://your-domain/...`** reachable from the internet (Twitch EventSub, YouTube hub, Kick, etc. call **your** API). Point `*_WEBHOOK_BASE_URL` (and paths) at the public URL that terminates TLS, usually behind nginx/Caddy.

Production secret policy:

- do **not** rely on `SESSION_SECRET` fallback wiring in production
- set dedicated values for `INTERNAL_API_TOKEN`, `PUBLIC_API_WRITE_TOKEN`, `LITE_API_WRITE_TOKEN`, `MOBILE_API_WRITE_TOKEN`, and `MOBILE_SESSION_SECRET`
- keep `MOBILE_SESSION_REQUIRED=true` in production so mobile creator routes require signed user sessions
- keep `TWITCH_WEBHOOK_SECRET` set whenever Twitch webhooks are enabled
- keep `YOUTUBE_WEBHOOK_PATH` on a non-default, unguessable path in production because YouTube does not sign POST notifications

Pager:

- In **API** env: `OPS_PAGER_DISCORD_WEBHOOK_URL`, pager policy vars.
- In **pager** env: `INTERNAL_API_TOKEN`, `API_BASE_URL=http://127.0.0.1:3101` (or internal URL if API is not localhost).

## 5. systemd units (templates in repo)

Templates live under `infra/systemd/`:

- `watchme-v2-api.service`
- `watchme-v2-worker.service`
- `watchme-v2-pager.service`
- `watchme-v2-pg-backup.service` + `watchme-v2-pg-backup.timer`

Install:

```bash
sudo cp /opt/watchme-v2/infra/systemd/*.service /etc/systemd/system/
sudo cp /opt/watchme-v2/infra/systemd/*.timer /etc/systemd/system/
```

Edit each unit if needed:

- **`User` / `Group`** — your deploy user.
- **`WorkingDirectory`** — `/opt/watchme-v2` (or your path).
- **`ExecStart`** — path to `node` (`which node` as deploy user).

Enable **in order** after Postgres is up:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now watchme-v2-api
sudo systemctl enable --now watchme-v2-worker
sudo systemctl enable --now watchme-v2-pager
```

Optional backup timer:

```bash
sudo mkdir -p /var/backups/watchme-v2/pg
sudo chown watchme:watchme /var/backups/watchme-v2/pg
sudo systemctl enable --now watchme-v2-pg-backup.timer
```

Details: `docs/paging-and-alerting.md`, `docs/validation-and-soak.md`.

## 6. Reverse proxy and TLS (recommended)

Expose **HTTPS** on 443; proxy to the API (default **`API_PORT` 3101**). Provider webhooks and browsers expect valid TLS.

- Terminate TLS on **Caddy** or **nginx**.
- Forward to `127.0.0.1:3101` for HTTP routes the API serves (including webhook paths under your configured paths).

Worker default **`WORKER_PORT` 3102** is mainly for health/ops; you often **do not** need to publish it publicly if the worker only talks to Postgres and outbound APIs.

## 7. Smoke checks on the VPS

From `/opt/watchme-v2` as the deploy user:

```bash
npm run check
curl -sS http://127.0.0.1:3101/api/health
```

`npm run check` is now a real config gate:

- API production checks fail if internal/public/lite/mobile secrets are missing or if mobile signed sessions are not enforced
- worker production checks fail if `INTERNAL_API_TOKEN`, `DISCORD_BOT_TOKEN`, Twitch webhook secret, or a non-default YouTube webhook path are missing

Run targeted smokes if your connectors are configured (`npm run smoke:paging`, etc.). Many smokes expect a full local stub stack; on VPS you may prefer **manual** checks (health, internal ops with token, Discord test message).

## 8. Long-run burn-in (optional on VPS)

Same as local: `npm run soak:stack` or `npm run soak:stack:1h` from the repo root **or** rely on systemd for true 24/7 operation.

## 9. After deploy

- Watch **`journalctl -u watchme-v2-api -f`** (and worker/pager) during first hours.
- Confirm pager Discord channel receives test incidents if you force a warning (non-prod overrides only where documented).
- Run **`npm run pg:backup`** or wait for the timer; copy dumps **off** the VPS.

## Guild list and member snapshot (SSH on the VPS)

WatchMe’s Postgres `guilds` table only has servers the app has **already touched**. To see **live** Discord data for those (or explicit IDs), use the bot token on the server:

```bash
cd /opt/watchme-v2
set -a && source /etc/watchme-v2/api.env   # or wherever DISCORD_BOT_TOKEN and DATABASE_URL live
set +a

# Guilds known to the DB + creator counts (Pro + Lite) + Discord name + approximate member counts
npm run discord:guild-snapshot -- --from-db

# DB only: every guild row + creators_pro / creators_lite / creators_total (no Discord token)
DATABASE_URL=... npm run report:guild-creators

# Same, plus full member list (paginated up to default 5000) — needs Server Members Intent in Dev Portal
npm run discord:guild-snapshot -- --from-db --members

# One guild by ID (no database)
npm run discord:guild-snapshot -- --guild=YOUR_GUILD_SNOWFLAKE --members
```

One-off **`curl`** (single guild, counts only, no member list):

```bash
curl -sS -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  "https://discord.com/api/v10/guilds/YOUR_GUILD_ID?with_counts=true"
```

Script: `scripts/discord-guild-snapshot.js`. If `--members` returns **403**, enable **Server Members Intent** (Privileged Gateway Intents) for the application in the [Discord Developer Portal](https://discord.com/developers/applications).

## Quick reference — ports

| Service | Default port | Typical exposure |
|---------|----------------|------------------|
| API | 3101 | Behind TLS proxy (public) |
| Worker HTTP | 3102 | Usually localhost only |
| Postgres | 5432 | Localhost only |
| Pager loop | none (outbound HTTP only) | N/A |

## Related docs

- `docs/validation-and-soak.md` — smokes, soak, backup drill, cutover checklist.
- `docs/paging-and-alerting.md` — pager env and systemd.
- `docs/cursor-pro-handoff.md` — ongoing build order.
- `.env.example` — all variables.
