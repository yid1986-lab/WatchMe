# WatchMe GitHub AI Task Board

Use these task sheets when giving work to Cursor, Perplexity, Codex, or another AI agent.

Each task is intentionally small and has one write root. Do not let an agent mix Pro, Lite, web, and Android in one pass unless the task explicitly says so.

## Priority Order

1. `01-pro-secure-discord-admin.md`
2. `02-pro-social-oauth.md`
3. `03-pro-live-embed-and-role.md`
4. `04-android-data-parity-and-ui.md`
5. `05-webpage-v2-data-parity.md`
6. `06-lite-isolation-smoke.md`

## Required Guardrails

- Pro V2 source of truth: `WatchMe project/pro.v2`
- Android source: `WatchMe project/watchme-android`
- Next website source: `WatchMe project/webpage.v2`
- Lite V2 source: `WatchMe project/lite.v2`
- Do not use V1, `_reference`, `_staging`, or `_artifacts` as active write targets.
- Do not commit secrets, Firebase configs, keystores, APKs, deploy bundles, database files, or dependency folders.

