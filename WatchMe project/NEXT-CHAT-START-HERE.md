# WatchMe Next Chat Start Here

Use this file as the first context note for the next chat.

## Clean workspace roots

- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\pro-bot`
  Pro V1 live bot
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\lite-bot`
  Lite V1 live bot
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\pro.v2`
  Pro V2 backend, workers, runtime
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\lite.v2`
  Lite V2 client
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\webpage watchme`
  Live website
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\webpage.v2`
  Next website

Workspace map:
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\WORKSPACE-INDEX.md`
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\_docs\workspace\WATCHME-WORKSPACE-BOUNDARIES.md`
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\_docs\workspace\WATCHME-V2-PROJECT-SPLIT.md`

## Current V2 split direction

- `lite.v2` is the Lite successor and must use Lite env/db/runtime only.
- `pro.v2` is the Pro successor and the source of truth for `webpage.v2` and `watchme-android`.
- `webpage.v2` is a web UI/proxy and must read/write Pro data through `pro.v2`.
- `watchme-android` is a native app and must read/write Pro data through `pro.v2`.
- Do not copy Lite env into Pro or Pro env into Lite.

## Current inspection result

The embed text layout change did **not** land in the active Pro V2 runtime.

Active file still using the old layout:
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\pro.v2\apps\worker\src\discord.js`

It still contains:
- embed title = `creator is LIVE on Twitch`
- `Title` field
- `Game` field
- `Viewers` field

So the repeated-line layout you saw is expected from the current active code.

## Live role feature status

Live-role support does exist in the active Pro V2 codebase:
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\pro.v2\apps\worker\src\discord.js`
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\pro.v2\apps\worker\src\handlers.js`
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\pro.v2\apps\worker\src\live-automation.js`
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\pro.v2\apps\worker\src\store.js`
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\pro.v2\apps\api\src\server.js`
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\pro.v2\apps\api\src\queries.js`

What this means:
- backend/runtime support for live roles is present
- the embed format cleanup is still missing in the active runtime
- if live roles are not showing in the product yet, the next checks should be:
  - whether the dashboard/UI is saving `live_role_id`
  - whether the worker is deployed from `pro.v2`
  - whether the active database rows contain `live_role_id` and `mention_mode`

## Next recommended task

Implement and test in the active Pro V2 runtime:

1. Change live embed layout in:
   - `C:\Users\yid19\OneDrive\Desktop\WatchMe project\pro.v2\apps\worker\src\discord.js`

2. Target format:
   - author/top line: `creator is LIVE on Twitch`
   - main title: stream title
   - description lines:
     - stream link
     - game/category
   - keep `Viewers` only as a field

3. Add fallback artwork priority:
   - server branding first
   - creator avatar/guild icon fallback when branding is blank

4. Verify live-role path end to end:
   - saved config path
   - worker payload path
   - mention output in Discord payload

## Important note

Earlier embed-format work appears to have landed in non-active copies instead of the canonical active root.
For this task, use `pro.v2` as the source of truth.
