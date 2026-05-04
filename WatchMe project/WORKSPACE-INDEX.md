# WatchMe Workspace Index

This is the first-read map for the WatchMe workspace.

## Active roots

- `pro-bot`
  Pro V1 live product. Safety fixes only.
- `lite-bot`
  Lite V1 live product. Safety fixes only.
- `pro.v2`
  Pro V2 backend, workers, queues, renewals, webhooks, Discord bot, and Pro data source of truth for web/mobile.
- `lite.v2`
  Lite V2 Discord client and Lite-owned runtime work. Do not point this at Pro env/db.
- `webpage watchme`
  Live website root.
- `webpage.v2`
  Next website root for cutover work.
- `watchme-android`
  Standalone Android/mobile work root. Keep isolated from bot and website runtime tasks.

## Support containers

- `_reference`
  Historical snapshots and lookup-only code.
- `_staging`
  Temporary patched copies and staging workspaces.
- `_artifacts`
  Upload bundles and packaged deploy outputs.
- `_ops`
  Shared PowerShell and deployment helper scripts.
- `_assets`
  Shared non-code assets such as Meta review files.
- `_docs`
  Workspace-level launch boards, boundaries, and runbooks.

## Website decision

- `webpage watchme` is the live site today.
- `webpage.v2` is the next site.
- Do not split one feature across both unless the task is explicitly a migration.

## V1 and V2 boundaries

- V1 live Pro bot work goes in `pro-bot`.
- V1 live Lite bot work goes in `lite-bot`.
- V2 backend and worker runtime work goes in `pro.v2`.
- V2 Lite Discord client work goes in `lite.v2`.
- V2 project split rules live in `_docs\workspace\WATCHME-V2-PROJECT-SPLIT.md`.
- Historical V2 lookup code lives in `_reference\watchme-v2`.

## If you need X, go here

- Discord bot live fix
  `pro-bot` or `lite-bot`
- Lite V2 client work
  `lite.v2`
- V2 backend or runtime work
  `pro.v2`
- Live website work
  `webpage watchme`
- Next website or cutover work
  `webpage.v2`
- Historical code lookup
  `_reference\watchme-v2`
- Deploy bundle output
  `_artifacts`
- Shared deploy script
  `_ops`
- Workspace rules and launch notes
  `_docs\workspace`
