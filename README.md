# WatchMe

Canonical WatchMe workspace for Pro V2, Lite V2, the next website, and the Android app.

## Start Here

Read these first before changing code:

- `WatchMe project/WORKSPACE-INDEX.md`
- `WatchMe project/NEXT-CHAT-START-HERE.md`
- `WatchMe project/_docs/workspace/WATCHME-V2-PROJECT-SPLIT.md`
- `WatchMe project/_docs/workspace/WATCHME-WORKSPACE-BOUNDARIES.md`

## Current Project Roots

- `WatchMe project/pro.v2` - Pro V2 backend, API, workers, Discord runtime, database schema, and source of truth for Pro data.
- `WatchMe project/lite.v2` - Lite V2 client/runtime. Must use Lite env, Lite token, and Lite database only.
- `WatchMe project/webpage.v2` - Next WatchMe website and web API proxy. Must use `pro.v2` as the backend source of truth.
- `WatchMe project/watchme-android` - Native Android app. Must use `pro.v2` APIs for Pro data.

## Boundaries

- Do not mix Lite and Pro env variables, bot tokens, databases, or workers.
- Do not use V1 roots for new work.
- Do not commit real `.env` files, Firebase configs, keystores, build outputs, APKs, deploy bundles, database files, or `node_modules`.
- Open small, focused pull requests tied to GitHub issues.

## Common Checks

```powershell
cd "WatchMe project/pro.v2"; npm run check; npm test
cd "WatchMe project/lite.v2"; npm run check; npm test
cd "WatchMe project/webpage.v2"; npm test; npm run build
cd "WatchMe project/watchme-android"; .\gradlew testDebugUnitTest assembleDebug
```

