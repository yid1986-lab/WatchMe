# Lite V2 Cutover Checklist

Client-side Lite ownership now lives in:

`C:\Users\yid19\OneDrive\Desktop\WatchMe project\lite.v2`

Keep this checklist here only as the backend-side reference while `pro.v2` still serves the current V2 API and worker runtime used by Lite V2.

Use this when preparing the scheduled update from the current Lite bot to Lite V2.

## Code readiness

- Lite V2 control panel opens with `/wme`
- Add Channel works
- Add Twitch works
- Add YouTube works
- Remove Creator works
- Test Channel works
- Refresh works
- 5 creator cap is enforced
- Pro upgrade prompt appears at the cap

## Data/API readiness

- `lite_creators` table exists in Postgres
- Lite API routes respond correctly:
  - `GET /api/lite/guilds/:guildId/capacity`
  - `GET /api/lite/guilds/:guildId/creators`
  - `POST /api/lite/guilds/:guildId/creators`
  - `DELETE /api/lite/guilds/:guildId/creators/:liteCreatorId`
  - `PUT /api/lite/guilds/:guildId/channel`

## Platform readiness

- Twitch event path is wired to Lite V2
- YouTube event/feed path is wired to Lite V2
- Lite does not include Kick

## Discord readiness

- slash command registered successfully
- bot has `Manage Guild` gate for Lite controls
- bot can send embeds in the selected alert channel

## Rollout readiness

- existing Lite V1 remains live until Lite V2 is proven
- Lite V2 is tested in private/internal guilds first
- migration window is scheduled
- rollback path is clear if needed

## Shelf point

Lite V2 is ready to sit on the shelf as the replacement when:
- the checklist above is green
- the current Lite V1 gets close to the chosen server threshold
- you are ready to schedule the update with confidence
