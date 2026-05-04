# lite.v2: Verify Lite Isolation From Pro

## Scope

Write root: `WatchMe project/lite.v2`

## Goal

Confirm Lite V2 cannot accidentally post through Pro, read Pro env, or share Pro database state.

## Acceptance Criteria

- Lite config only reads `LITE_*` env values.
- Lite does not fallback to Pro Discord token, Pro API token, or Pro database URL.
- Lite save/post flows are covered by smoke tests.
- A Lite creator cannot trigger Pro posting.
- Docs clearly list required Lite env values.

## Checks

```powershell
cd "WatchMe project/lite.v2"
npm run check
npm test
```

## Boundaries

- Do not edit `pro.v2` in this task.
- Do not copy Pro env values into Lite docs/examples.

