# pro.v2: Make Social OAuth Real And Consistent

## Scope

Write roots:

- `WatchMe project/pro.v2`
- `WatchMe project/webpage.v2` only if proxy/UI wiring is required
- `WatchMe project/watchme-android` only if mobile OAuth launch/refresh wiring is required

## Goal

Replace fake/local social connection state with real V2 OAuth-backed connections stored in Pro V2 Postgres.

## Acceptance Criteria

- `POST /api/mobile/social/oauth/start` creates durable OAuth state and returns a provider authorize URL.
- `GET /api/mobile/social/oauth/callback` verifies state, exchanges code, fetches provider identity, and saves the connection.
- `DELETE /api/mobile/social/connections/:platform` disconnects a saved connection.
- Android and web read only backend-saved social connections.
- Facebook handles Page selection, Instagram uses linked business account, TikTok and X use their V2 env config, YouTube remains disabled until credentials exist.
- Add tests for state creation, expiry, reuse rejection, callback success/error, save/read/disconnect.

## Checks

```powershell
cd "WatchMe project/pro.v2"
npm run check
npm test

cd "WatchMe project/webpage.v2"
npm test
npm run build

cd "WatchMe project/watchme-android"
.\gradlew testDebugUnitTest assembleDebug
```

## Boundaries

- Do not copy secrets from V1 into source code.
- Do not commit real `.env`, Firebase, or OAuth secret files.
- Do not touch Lite.

