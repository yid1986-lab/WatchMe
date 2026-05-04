# WatchMe Shared Host SSH Checklist

Use this after SSH access is provided.

Purpose:

- confirm what is actually deployed on the shared host
- validate the local audit findings against live configuration
- identify drift between local code and server reality
- capture launch blockers before public rollout

## 1. Host Layout

- Confirm hostname, OS, and primary deploy user
- Confirm whether `pro.v2`, `webpage watchme`, and any Lite runtime share the same machine
- Locate deployed app roots
- Identify which directories are canonical and which are staging or old copies

Record:

- deployed path for `pro.v2`
- deployed path for website runtime
- deployed path for any Lite runtime process
- active env file locations

## 2. Process Supervision

Check:

- running Node processes
- `systemd` services
- PM2 processes if present
- startup order and restart policy

Confirm whether these exist and are healthy:

- Pro V2 API
- Pro V2 worker
- Pro V2 pager loop
- website server
- Lite V2 bot process if deployed on the same host

## 3. Environment And Secrets

Inspect env handling without exposing secrets in notes:

- `NODE_ENV`
- `DATABASE_URL`
- `INTERNAL_API_TOKEN`
- `PUBLIC_API_WRITE_TOKEN`
- `LITE_API_WRITE_TOKEN`
- `MOBILE_API_WRITE_TOKEN`
- `MOBILE_SESSION_SECRET`
- `SESSION_SECRET`
- `PRO_BOT_BASE_URL`
- `OPS_PAGER_DISCORD_WEBHOOK_URL`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_PLAN_ID`
- `PAYPAL_WEBHOOK_ID`
- platform webhook secrets and API keys

Validate:

- whether multiple roles still collapse to `SESSION_SECRET`
- file permissions on env files
- whether website and Pro V2 use separate secrets where appropriate
- whether production values are set instead of local defaults

## 4. Website Checks

Verify:

- website process is serving the expected root
- reverse proxy points to the correct upstream
- `PRO_BOT_BASE_URL` resolves to the intended backend
- Discord OAuth callback host and scheme match production
- PayPal webhook id is present
- persistence mode is known: Postgres or file-backed

Quick checks:

- health endpoint
- login redirect path
- dashboard API routing
- billing webhook/log presence

## 5. Pro V2 Checks

Verify:

- API and worker are using the intended checkout
- worker port exposure is appropriate
- `INTERNAL_API_TOKEN` is required for internal routes
- Twitch webhook secret is set
- YouTube, Kick, Discord, and social env variables match enabled connectors
- Postgres schema exists and points at the right database
- pager loop is enabled and reachable
- backup timer or backup process exists

Quick checks:

- `/api/health`
- internal ops endpoints with token
- worker `/ops/runtime` access behavior
- service logs for startup errors

## 6. Lite Runtime Checks

If Lite V2 is deployed on the same host, verify:

- correct Discord token source
- `LITE_API_BASE_URL`
- write-token behavior
- whether Lite V1 is still present anywhere
- whether Lite V1 and Lite V2 could overlap on the same token

Cutover-specific checks:

- current live owner of the Lite Discord token
- rollback path
- first-guild `/wme` validation steps

## 7. Database And Backups

Confirm:

- Postgres service state
- database name and owner
- backup schedule
- restore-drill readiness
- whether website session storage is durable
- whether website data is file-backed instead of DB-backed

Look for:

- backup output path
- restore tooling availability
- recent backup timestamps

## 8. Logging And Monitoring

Check:

- journal or process logs for API, worker, pager, website
- recent auth errors
- recent webhook or connector errors
- recent queue or heartbeat warnings
- pager delivery health

Confirm whether there is:

- uptime monitoring
- alert routing
- a known log-retention approach

## 9. Production Drift Review

Compare live host state against the local audit:

- is `PRO_BOT_BASE_URL` still localhost-derived
- is PayPal webhook verification fully configured
- does worker internal auth fail closed
- are preview-only or fallback behaviors still relied on in production
- does website/dashboard feature availability match the current code and copy

## 10. Exit Criteria

The SSH phase is complete when all of the following are clear:

1. deployed source-of-truth paths are known
2. runtime process ownership is known
3. secret split and env hygiene are understood
4. database and backup posture are confirmed
5. reverse proxy and public routing are confirmed
6. key launch blockers are either validated closed or still explicitly open
7. local audit findings have been updated to reflect live server truth
