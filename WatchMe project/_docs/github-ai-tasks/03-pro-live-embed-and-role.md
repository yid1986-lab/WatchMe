# pro.v2: Fix Live Embed Layout And Verify Live Roles

## Scope

Write root: `WatchMe project/pro.v2`

## Goal

Fix the active Pro V2 live embed layout and verify the live-role mention path end to end.

## Target Embed Format

- Author/top line: `{creator} is LIVE on Twitch`
- Main title: stream title
- Description line 1: stream link
- Description line 2: game/category
- Field: keep `Viewers` only

## Artwork Fallback

Use this priority:

1. Server branding image
2. Creator avatar
3. Guild icon
4. No image

## Acceptance Criteria

- `WatchMe project/pro.v2/apps/worker/src/discord.js` emits the target layout.
- Title/Game duplicate fields are removed.
- Live role is loaded from saved guild config.
- Discord payload includes role mention when `mention_mode` and `live_role_id` require it.
- Tests cover embed format and mention behavior.

## Checks

```powershell
cd "WatchMe project/pro.v2"
npm run check
npm test
```

## Boundaries

- Do not edit V1 bot roots.
- Do not touch Lite.

