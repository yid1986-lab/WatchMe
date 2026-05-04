# Lite V2 Backend Contract

`lite.v2` is the standalone Lite Discord client workspace.

It is not the webhook runtime.
It is not the background worker.
It is not the durable subscription store.

Current contract:
- `lite.v2` owns the Discord command and panel experience
- `pro.v2` currently owns the shared V2 backend runtime for:
  - `POST /api/lite/guilds/:guildId/creators`
  - `DELETE /api/lite/guilds/:guildId/creators/:liteCreatorId`
  - `PUT /api/lite/guilds/:guildId/channel`
  - durable `platform_subscriptions`
  - webhook intake and renewal
  - worker fan-out for Twitch and YouTube

Why this matters:
- the newer YouTube webhook/runtime work should not be copied into `lite.v2/src`
- the correct Lite V2 path is:
  1. Lite Discord client saves a creator through the Lite API
  2. V2 backend provisions or updates a durable subscription
  3. worker runtime renews provider subscriptions
  4. webhook events flow through the worker and fan out to the guild

Current confirmed state:
- `lite.v2` already exposes Twitch and YouTube add flows
- `pro.v2` already has Lite API routes and `syncLitePlatformSubscriptions(...)`
- `pro.v2` worker already has the durable YouTube runtime path

Near-term rule:
- if the task is Discord UX, panels, commands, prompts, or client API calls, do it in `lite.v2`
- if the task is provider subscriptions, webhook routes, renewal loops, queue work, or live delivery, do it in `pro.v2`
