# webpage.v2: Match Pro Data Across Web And Mobile

## Scope

Write root: `WatchMe project/webpage.v2`

## Goal

Ensure the next website reads and writes the same Pro V2 data that Android uses.

## Acceptance Criteria

- Web config, creators, branding, post builder, socials, and dashboard views proxy through `webpage.v2/apps/api` into `pro.v2`.
- Web does not keep fake/local state that disagrees with Android.
- Authenticated proxy routes preserve the user's Discord session and target guild.
- Visual layout remains usable at mobile width.
- Add smoke tests for proxy routes and the main control tower view.

## Checks

```powershell
cd "WatchMe project/webpage.v2"
npm test
npm run build
```

## Boundaries

- Do not edit live `webpage watchme`.
- Do not edit Lite.
- Backend contract changes must be done in a separate `pro.v2` task.

