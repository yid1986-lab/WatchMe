# WatchMe Lite V2

`lite.v2` is the standalone Lite V2 workspace.

This root exists so Lite V2 can be built and tested independently from:
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\lite-bot`
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\pro-bot`
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\pro.v2`
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\watchme-v2`

Lite V2 product rules:
- Discord-first only
- Manage Server controlled
- Twitch and YouTube only
- 5 creators total per server
- show a Pro upgrade path instead of allowing more creators on Lite

Useful commands:
- `npm run check`
- `npm run preflight`
- `npm run rehearsal`
- `npm run smoke`
- `npm run smoke:backend`
- `npm run stress:backend`
- `npm start`

Smoke notes:
- `npm run smoke` runs the offline launch smoke first, then the interaction smoke test
- set `LITE_SMOKE_USE_BACKEND=1` if you want the smoke path to probe the local Lite API too
- `npm run smoke:backend` boots a protected mocked `pro.v2` API server and exercises real Lite V2 reads and writes through the API client
- `npm run stress:backend` forwards to the proven `pro.v2/scripts/lite-pipeline-check.js` harness with a Lite V2-owned entrypoint and defaults to `1000 guilds x 3 events`
- `npm run preflight` is the real cutover pre-check for a configured V2 API and scheduled Lite token/env
- set `LITE_PREFLIGHT_ALLOW_WRITES=1` if you want `npm run preflight` to perform a disposable protected write cycle against a staging guild
- `npm run rehearsal` runs the Lite-owned cutover gate: local check, full test suite, staged preflight, optional `--with-writes`, and optional `--with-stress --stress-guilds=... --stress-events=...`

Env:
- `LITE_DISCORD_TOKEN` is required for the Lite bot runtime
- `LITE_API_WRITE_TOKEN` is required for Lite write routes
- `LITE_DATABASE_URL` belongs to the Lite database only
- `LITE_API_BASE_URL` should point at the Lite API/runtime, not the Pro API
- set `LITE_COMMAND_GUILD_ID` during staging if you want `/wme` registered only in one test guild instead of globally
- do not fall back to Pro or V1 names such as `DISCORD_BOT_TOKEN`, `DISCORD_TOKEN`, `PUBLIC_API_WRITE_TOKEN`, or `SESSION_SECRET`

Permissions:
- the `/wme` command requires Discord's `Manage Server` permission
- panel actions and creator/channel changes also require `Manage Server`
- copy and support docs should describe this as `Manage Server`, not generic moderator access

Important files:
- `src/index.js`
- `src/discord-runtime.js`
- `src/api-client.js`
- `src/panel.js`
- `src/submission.js`
- `docs/lite-v2-backend-contract.md`
- `docs/lite-cutover-checklist.md`

Current note:
- this root is the clean separation point for Lite V2
- the Lite API/runtime still needs to be split out from the old Pro V2 compatibility routes
- webhook and worker runtime changes for Lite should be added here as Lite-owned runtime code
- the scheduled switch plan from Lite V1 to Lite V2 is pinned in `docs/lite-cutover-checklist.md`
