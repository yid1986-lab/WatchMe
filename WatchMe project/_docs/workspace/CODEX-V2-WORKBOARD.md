# Codex V2 Workboard

This is the active V2 coordination board for Codex work.

Launch status board:
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\_docs\workspace\WATCHME-LAUNCH-BOARD.md`

Workspace index:
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\WORKSPACE-INDEX.md`

## Canonical roots

- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\pro-bot`
  Pro V1 live product
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\lite-bot`
  Lite V1 live product
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\pro.v2`
  V2 backend and worker runtime
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\lite.v2`
  V2 Lite Discord client
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\webpage watchme`
  Live website
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\webpage.v2`
  Next website root
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\_reference\watchme-v2`
  Reference-only historical snapshot

## V2 program rule

Treat `pro.v2`, `lite.v2`, and `webpage.v2` as the active next-generation roots.
Do not add fresh feature work to `_reference\watchme-v2`.

## Ownership lanes

- `pro-bot`
  Live Pro V1 safety only
- `lite-bot`
  Live Lite V1 safety only
- `pro.v2`
  API, queues, workers, webhooks, durable subscriptions, runtime hardening
- `lite.v2`
  Discord UX, commands, prompts, panel flow, Lite client-side behavior
- `webpage watchme`
  Live website operations and launch-safe support
- `webpage.v2`
  Website replacement and cutover work

## Current architecture contract

- `lite.v2` is the standalone Lite Discord client.
- `pro.v2` serves the shared V2 backend runtime used by:
  - Pro V2
  - Lite V2 API routes
  - provider renewals and webhooks
  - worker fan-out for Twitch and YouTube
- `webpage watchme` remains live until cutover.
- `webpage.v2` is the only place for future website replacement work.

## Immediate next work

1. keep V2 ownership clean while we continue launch work
2. finish backward-merge cleanup without destabilizing V1
3. port intended YouTube webhook/runtime behavior onto the V2 backend path
4. keep Lite V2 client work isolated in `lite.v2`
5. keep website cutover work isolated in `webpage.v2`

## Agent rule

Each agent gets exactly one project root.
No agent should edit `_reference\watchme-v2` except to read reference material.
