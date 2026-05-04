# WatchMe Workspace Boundaries

Workspace root:
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project`

## Canonical active roots

- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\pro-bot`
  Pro V1 live product. Safety fixes only.
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\lite-bot`
  Lite V1 live product. Safety fixes only.
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\pro.v2`
  V2 backend, workers, queues, renewals, webhooks, and shared runtime.
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\lite.v2`
  V2 Lite Discord client and Lite-side UX flow.
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\webpage watchme`
  Live website root.
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\webpage.v2`
  Next website root. Build here only for cutover work.

## Non-active containers

- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\_reference`
  Read-only historical lookup roots. No fresh feature work.
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\_staging`
  Temporary patched copies, Codex staging workspaces, and VPS scratch copies.
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\_artifacts`
  Upload bundles, tarballs, zip files, and deploy artifacts only.
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\_ops`
  Shared PowerShell and deployment helper scripts.
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\_assets`
  Shared non-code assets such as Meta review files.
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\_docs`
  Workspace-level runbooks, launch boards, and coordination docs.

## Reference-only rule

- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\_reference\watchme-v2`
  Historical snapshot for notes and code lookup only.
- Do not add fresh feature work there.
- If code is worth keeping, migrate it intentionally into `pro.v2`, `lite.v2`, or the chosen website root.

## Website ownership rule

- `webpage watchme` is the live website root right now.
- `webpage.v2` is the active replacement website root.
- Do not split one feature across both roots in the same task unless the task is explicitly a migration.
- If a change is live-site support, do it in `webpage watchme`.
- If a change is future cutover UI or V2 website runtime work, do it in `webpage.v2`.

## V2 contract

- `lite.v2` is the standalone Lite Discord client root.
- `pro.v2` serves the shared V2 backend runtime used by Pro V2 and Lite V2 backend flows.
- Do not move webhook or worker runtime code into `lite.v2` unless we intentionally add a real Lite backend service there.
- Do not collapse `pro.v2` and `lite.v2`.

## Agent rule

- Only assign one project root per agent.
- Do not let agents edit anything under `_reference`.
- Do not let agents treat `_staging` as canonical source unless the task is explicitly about promoting staged work.
