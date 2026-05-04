# V2 Paging And Alerting

## Purpose

V2 paging sits on top of the existing internal ops health surface.

The goal is:
- turn queue and social warnings into durable incidents
- page once when a problem appears
- avoid noisy repeats during the same outage
- send a recovery when the warning clears

## What is real now

Built:
- durable `ops_pager_incidents` state in Postgres
- durable `ops_pager_deliveries` audit rows in Postgres
- durable `worker_heartbeats` telemetry in Postgres
- internal paging status route at `GET /api/internal/ops/paging`
- internal paging sweep route at `POST /api/internal/ops/paging/run`
- Discord webhook delivery for page and recovery notifications
- cooldown-aware dedupe for repeated warning sweeps
- reminder support for long-running incidents
- non-production `warning_overrides` for safe local smoke tests
- separate pager loop runner at `scripts/ops-pager-loop.js`

## Current policy

Default env policy:
- `OPS_PAGER_MIN_SEVERITY=high`
- `OPS_PAGER_COOLDOWN_SECONDS=900`
- `OPS_PAGER_REMINDER_SECONDS=3600`
- `OPS_PAGER_SEND_RECOVERY=true`

Current delivery target:
- Discord webhook through `OPS_PAGER_DISCORD_WEBHOOK_URL`

This means:
- new `high` or `critical` warnings page immediately
- repeated sweeps do not resend immediately
- long-lived incidents can send reminders
- cleared incidents send a recovery message when enabled

Worker-health warnings now included in the pageable ops surface:
- `worker_heartbeat_missing`
- `worker_heartbeat_stale`
- `worker_memory_rss_high`
- `worker_memory_heap_high`

Escalation warnings (also pageable when severity meets `OPS_PAGER_MIN_SEVERITY`):
- `worker_restart_storm` — several **running** workers report `started_at` inside `OPS_WORKER_RESTART_STORM_WINDOW_SECONDS` (default 900s), at least `OPS_WORKER_RESTART_STORM_MIN_COUNT` (default 3). Surfaces coordinated deploys or crash loops when you run multiple worker processes.
- `pager_webhook_delivery_failures` — at least `OPS_PAGER_DELIVERY_FAIL_MIN_COUNT` failed rows in `ops_pager_deliveries` within `OPS_PAGER_DELIVERY_FAIL_WINDOW_SECONDS` (default 3600s). Surfaces a broken Discord webhook or outbound path while other problems may be silent.
- `worker_heartbeat_stale_persistent` / `worker_heartbeat_missing_persistent` — emitted when the base worker health warning is still true **and** the matching pager incident has stayed active for either `OPS_ESCALATE_WORKER_HEALTH_MIN_OCCURRENCES` sweeps (default 10) or `OPS_ESCALATE_WORKER_HEALTH_MIN_AGE_SECONDS` (default 1800). These are separate incident codes so they open their own cooldown/reminder timeline beside the original warning.

## Current routes

- `GET /api/internal/ops/paging`
  Returns current pageable warnings, incident state, recent delivery audit, and live ops stats.

- `POST /api/internal/ops/paging/run`
  Runs one pager sweep against the current ops summary.

Request body options:
- `dry_run: true`
  Calculates pager actions without writing incident state or sending webhooks.
- `warning_overrides: [...]`
  Safe non-production test input for local smoke coverage.

## Local validation

Current pager checks:
- `npm run check`
- `npm test`
- `npm run smoke:paging`
- `npm run smoke:worker-heartbeat`

`npm run smoke:paging` proves:
- first warning pages once
- immediate rerun stays suppressed by cooldown
- cleared warning sends one recovery
- pager incident state is durable and queryable through the API

`npm run smoke:worker-heartbeat` proves:
- the real worker runner writes heartbeat telemetry
- API ops routes expose active worker state through `summary.workers`
- low memory thresholds raise RSS and heap warnings
- an artificially aged heartbeat row raises `worker_heartbeat_stale`

## Loop runner

The loop runner is:
- `npm run dev:pager`

It repeatedly calls:
- `POST /api/internal/ops/paging/run`

Use this as a separate long-running process beside the API and worker when you want pager sweeps to happen continuously.

One-shot sweep (health checks, debugging):
- `npm run pager:once`

Env:
- `INTERNAL_API_TOKEN` — must match the API (sent as `x-internal-token`)
- `API_BASE_URL` or `WATCHME_V2_API_BASE_URL` — default `http://127.0.0.1:3101`
- `OPS_PAGER_LOOP_INTERVAL_SECONDS` — default `60` (minimum effective interval 5 seconds)

The loop handles `SIGINT` / `SIGTERM` so systemd can stop it within about one sweep plus the stop timeout.

## VPS supervision (systemd)

Template unit file:
- `infra/systemd/watchme-v2-pager.service`

Install on the VPS (adjust paths and user):

1. Copy the unit to `/etc/systemd/system/watchme-v2-pager.service`.
2. Set `User`, `Group`, and `WorkingDirectory` to your deploy user and app root (same tree that contains `scripts/ops-pager-loop.js`).
3. Ensure `ExecStart` points at the same Node binary you use for API/worker (`which node`).
4. Create `/etc/watchme-v2/pager.env` (mode `600`) with at least:
   - `INTERNAL_API_TOKEN=...` (same value as the API process)
   - `API_BASE_URL=http://127.0.0.1:3101` if the API listens elsewhere
   - optional `OPS_PAGER_LOOP_INTERVAL_SECONDS=60`
5. `sudo systemctl daemon-reload && sudo systemctl enable --now watchme-v2-pager`
6. `systemctl status watchme-v2-pager` and `journalctl -u watchme-v2-pager -f` to verify.

Run the API and worker under systemd as well for a clean solo deployment: see `infra/systemd/watchme-v2-api.service` and `infra/systemd/watchme-v2-worker.service`, plus the cutover checklist in `docs/validation-and-soak.md`. Start order: API → worker → pager.

## What is not done yet

Still missing:
- no Slack, email, SMS, or phone escalation path yet
- no third-party on-call integration beyond Discord webhook

## Next sensible steps

1. Add worker-heartbeat escalation rules for repeated stale incidents or restart storms.
3. Add a second delivery target later only if Discord webhook paging proves too weak.
