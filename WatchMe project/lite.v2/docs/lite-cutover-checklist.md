# Lite V1 To Lite V2 Cutover Checklist

Use this for the scheduled replacement of `lite-bot` with `lite.v2`.

This is a switch-over plan, not a side-by-side run plan.
Do not run Lite V1 and Lite V2 on the same Discord bot token at the same time.

## Cutover rule

The safe cutover model is:

1. stop Lite V1
2. start Lite V2
3. verify the first live interactions
4. keep rollback ready

Do not overlap them on:
- the same Discord bot token
- the same slash command registration window
- the same public callback URLs

## What is already proven

Before this cutover pack:

- Lite V1 has a shelf-state bridge pass and a `50` guild rehearsal
- Lite V2 client tests pass
- Pro V2 backend tests pass
- Lite-through-V2 VPS smoke and bounded batch runs passed
- protected Lite V2 client-to-API proof exists, but should now be pointed at Lite-owned API/env
- staged Lite V2 preflight should use explicit `LITE_*` env only
- Lite V2 now has a repeatable rehearsal entrypoint through `npm run rehearsal`
- staged Lite V2 cutover rehearsal should use explicit `LITE_*` env only

That means the remaining risk is operational cutover discipline, not missing architecture.

Latest staged rehearsal evidence on April 9, 2026:

- `npm run rehearsal -- --with-writes --guild=staged-cutover-rehearsal-20260409`
- passed through:
  - launch check
  - full Lite V2 test suite
  - staged preflight
  - staged disposable write-cycle preflight
- staged guild ended cleanly with `0` creators and no saved alert channel shown after cleanup

## Preconditions

All of these should be true before the switch:

- [lite.v2](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite.v2) `npm test` is green
- [pro.v2](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro.v2) `npm test` is green
- the VPS has the latest staged `pro.v2` checkout
- the Lite-facing backend path is reachable on the VPS
- the Discord bot token you will use for Lite V2 is the same scheduled token currently used by Lite V1
- rollback access to the Lite V1 code and env is ready

## Env mapping

Lite V2 no longer accepts V1 or Pro fallback env names.

Recommended staged env on the VPS for Lite V2:

```env
LITE_API_BASE_URL=http://127.0.0.1:3201
LITE_API_WRITE_TOKEN=<dedicated Lite write token>
LITE_DATABASE_URL=postgres://...
LITE_PRO_UPGRADE_URL=https://pro.watchme-bot.com/login
LITE_COMMAND_GUILD_ID=<optional staging guild id for guild-scoped /wme registration>
LITE_DISCORD_TOKEN=<existing Lite bot token>
```

Recommended staged env on the VPS for Pro V2 API:

```env
API_PORT=3101
DATABASE_URL=postgres://...
INTERNAL_API_TOKEN=<dedicated random value>
PUBLIC_API_WRITE_TOKEN=<dedicated random value>
LITE_API_WRITE_TOKEN=<dedicated random value>
MOBILE_API_WRITE_TOKEN=<dedicated random value>
MOBILE_SESSION_SECRET=<dedicated random value>
MOBILE_SESSION_REQUIRED=true
SESSION_SECRET=<cookie/session secret only>
DISCORD_TOKEN=<existing Lite/Pro bot token if needed by staged runtime>
YOUTUBE_API_KEY=...
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
TWITCH_WEBHOOK_SECRET=...
YOUTUBE_WEBHOOK_PATH=/webhooks/youtube-<unguessable-suffix>
```

Notes:

- do not chain Lite auth back to `SESSION_SECRET`, `PUBLIC_API_WRITE_TOKEN`, `DISCORD_TOKEN`, or Pro env names
- if you set `LITE_COMMAND_GUILD_ID`, Lite V2 will register `/wme` only in that staging guild instead of globally

## Files to have ready

- [lite.v2/.env.example](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite.v2/.env.example)
- [lite.v2/README.md](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite.v2/README.md)
- [pro.v2/.env.example](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro.v2/.env.example)
- [pro.v2/docs/validation-and-soak.md](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro.v2/docs/validation-and-soak.md)

## Pre-cutover checks

Run before the maintenance window:

### Local checks

- `cd C:\Users\yid19\OneDrive\Desktop\WatchMe project\lite.v2`
- `npm run rehearsal`
- optional disposable write-cycle rehearsal:
  `npm run rehearsal -- --with-writes --guild=staged-cutover-rehearsal`
- optional staged Lite backend stress during a non-cutover window:
  `npm run rehearsal -- --with-stress --stress-guilds=1000 --stress-events=3`
- `npm test`
- `npm run preflight`
- optional staged write pass:
  `LITE_PREFLIGHT_ALLOW_WRITES=1 npm run preflight`
- `npm run smoke:backend`
- `cd C:\Users\yid19\OneDrive\Desktop\WatchMe project\pro.v2`
- `npm test`

### VPS staged checks

- confirm the staged `pro.v2` API starts on the VPS
- confirm `curl http://127.0.0.1:3201/api/health` works on the VPS
- confirm `npm run preflight` passes from [lite.v2](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite.v2) against the staged API
- confirm `npm run rehearsal` passes from [lite.v2](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite.v2) against the staged API target before the live token switch
- optional staged write pass:
  run `LITE_PREFLIGHT_ALLOW_WRITES=1 npm run preflight` against a disposable guild ID before the real cutover window
- confirm the protected Lite client-to-API staged smoke passes

### Freeze rule

During the cutover window:

- do not edit source files
- do not rotate tokens
- do not change callback URLs
- do not change database targets

## Maintenance window sequence

### 1. Stop Lite V1

Stop the current Lite V1 process cleanly on the VPS.

If it is a plain Node process:

```bash
pkill -f 'lite-bot'
```

If it is a named start command or service, use the existing stop command for that deployment.

### 2. Confirm Lite V1 is down

Confirm:

- no Lite V1 bot process is running
- the old Lite app is no longer registering or handling `/wme`

### 3. Start Pro V2 API if not already running

Manual staged start shape:

```bash
cd /opt/watchme-v2
set -a
source .env
set +a
node apps/api/src/index.js
```

For background manual staging:

```bash
cd /opt/watchme-v2
set -a
source .env
set +a
nohup node apps/api/src/index.js >/tmp/watchme-v2-api.log 2>&1 < /dev/null &
```

### 4. Start Lite V2

Use the Lite V2 env with the scheduled Discord token and the Lite API base URL pointing at the V2 API.

Start shape:

```bash
cd /path/to/lite.v2
set -a
source .env
set +a
node src/index.js
```

If using a background manual run:

```bash
cd /path/to/lite.v2
set -a
source .env
set +a
nohup node src/index.js >/tmp/lite-v2.log 2>&1 < /dev/null &
```

## First 15-minute verification

These are the required live checks immediately after start:

### Discord checks

In one real guild:

- `/wme` opens
- panel renders
- current saved creators load
- current alert channel state loads
- Add Creator works
- Remove Creator works
- Refresh works
- Test Channel works

### Backend checks

Verify:

- `GET /api/health` returns `ok: true`
- Lite creator add writes through the protected Lite API route
- Lite creator delete writes through the protected Lite API route
- capacity reads are correct

### Event path checks

Verify at least one real live alert path after cutover:

- Twitch live alert or
- YouTube live alert

The point is to prove the real Discord bot plus V2 backend plus provider path together once the new build owns the token.

## Rollback triggers

Rollback immediately if any of these happen:

- `/wme` does not render
- channel save fails across multiple tries
- creator add/remove is broken
- Discord bot login fails
- command sync is obviously broken
- live alerts stop entirely
- the API cannot be kept healthy

## Rollback sequence

1. stop Lite V2
2. confirm Lite V2 process is down
3. restart Lite V1 with the previous known-good env
4. verify `/wme` in one guild
5. verify one alert flow
6. keep Lite V2 logs and do not hot-edit under pressure

## Minimal commands to keep nearby

API health:

```bash
curl -sS http://127.0.0.1:3201/api/health
```

Check staged API log:

```bash
tail -n 100 /tmp/watchme-v2-api.log
```

Check Lite V2 log:

```bash
tail -n 100 /tmp/lite-v2.log
```

Stop staged API:

```bash
pkill -f 'apps/api/src/index.js'
```

Stop Lite V2:

```bash
pkill -f 'lite.v2'
```

## After a successful cutover

If the switch holds cleanly:

- mark Lite V1 as inactive
- keep Lite V1 code only for rollback reference
- continue all active Lite work in [lite.v2](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite.v2)
- continue all backend work in [pro.v2](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro.v2)

## Current remaining pre-cutover gap

One important gap is still intentionally open:

- we have not yet run a live Discord `/wme` interaction on the VPS with Lite V2 owning the real production token

That is expected.
It is the scheduled cutover itself, not something to do in the background.
