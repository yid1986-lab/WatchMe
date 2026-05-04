# WatchMe V2 Project Split

This workspace has four active V2 projects. Keep the boundaries below strict.

## Projects

### lite.v2

Lite successor only.

Owns:
- Lite Discord client.
- Lite env.
- Lite database.
- Lite API/runtime/workers as they are split out.

Must not use:
- Pro Discord token.
- Pro API write token.
- Pro database URL.
- Pro worker for Lite Discord posting.

### pro.v2

Pro successor and Pro data source of truth.

Owns:
- Pro Discord bot.
- Pro API.
- Pro worker, queues, renewals, webhooks, pager.
- Pro database.
- Shared Pro data used by `webpage.v2` and `watchme-android`.

Must not use:
- Lite Discord token.
- Lite database.
- Lite API write token.
- Lite creator tables as active product data.

Transitional note:
- Some Lite API compatibility files still exist in `pro.v2` until the Lite backend/runtime is fully moved into `lite.v2`.
- These are legacy compatibility only and must not be expanded.

### webpage.v2

Next website only.

Owns:
- Web UI and web API proxy/session layer.

Must use:
- `pro.v2` APIs for all Pro product data.

Must not own:
- Creator source-of-truth data.
- Guild config source-of-truth data.
- Social connection source-of-truth data.

### watchme-android

Android app only.

Owns:
- Native Android UI.
- Session storage and display cache.

Must use:
- `pro.v2` APIs for all Pro product data.

Must not own:
- Fake/local connected socials.
- Fake/local guild config.
- Fake/local branding/post builder data beyond short-lived cache.

## Env Rules

Pro env belongs in `pro.v2` and on `/opt/watchme-v2`.

Lite env belongs in `lite.v2` and on the Lite VPS runtime.

Never copy Lite env into Pro.
Never copy Pro env into Lite except public URLs such as an upgrade link.
Never let `LITE_*` tokens fall back to `PUBLIC_API_WRITE_TOKEN`, `SESSION_SECRET`, `DISCORD_TOKEN`, or `DISCORD_BOT_TOKEN`.

## Runtime Rules

Pro runtime:
- `watchme-v2-api`
- `watchme-v2-worker`
- `watchme-v2-pager`
- `watchme-pro-v2-discord`

Lite runtime:
- `watchme-lite-v2`
- future `watchme-lite-v2-api`
- future `watchme-lite-v2-worker`

V1 runtimes are archive/safety-only.

## Current Cleanup State

Done:
- `lite.v2` config now requires explicit `LITE_DISCORD_TOKEN` and `LITE_API_WRITE_TOKEN`.
- `lite.v2` default API base changed to its own port, `http://127.0.0.1:3201`.
- `pro.v2` no longer requires `LITE_API_WRITE_TOKEN` in production config validation.
- `pro.v2` default tests no longer run Lite compatibility tests.
- `pro.v2` worker token helpers no longer fall back to the Pro bot token for Lite targets.

Still to split:
- Move Lite API routes from `pro.v2/apps/api/src/server.js` and `pro.v2/apps/api/src/lite.js` into a real Lite API in `lite.v2`.
- Move Lite subscription sync logic from `pro.v2/apps/api/src/queries.js` into Lite-owned database/runtime code.
- Move Lite pipeline check script from `pro.v2/scripts/lite-pipeline-check.js` into `lite.v2`.
- Move Lite DB tables out of the Pro DB into a Lite DB.

