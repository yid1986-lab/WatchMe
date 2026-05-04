# WatchMe V2 Access Model

## Lite

- No automatic welcome post
- No website UI for regular users
- Supports Twitch and YouTube only
- Setup stays admin/mod controlled inside Discord
- Maximum of 5 creators per server total
- When the 5 creator limit is reached:
  - block new adds
  - show upgrade prompt
  - link users to Pro login or upgrade page

## Pro

- A Pro purchase becomes a single server entitlement
- That entitlement is bound to one guild when the Pro install is confirmed
- Once bound, that guild is the Pro server for that entitlement
- Creators can have one global WatchMe profile tied to their Discord user ID
- Entitlement status should explicitly support:
  - `active`
  - `grace_period`
  - `inactive`
  - `manual_test`
  - `manual_free`
- If Pro becomes `inactive`, the bot stays installed but only Lite-safe behavior should remain available

## Website UI permissions

- Only admins/mods of the bound guild can access the website UI
- Website UI is for:
  - guild configuration
  - approvals
  - branding
  - channel settings
  - platform connections
  - social grab controls
  - live builder and test-post tools

## Regular user permissions

- Regular users do not use the website UI
- Regular users use Discord and, later, the creator mobile app
- Their creator profile is saved globally by Discord user ID
- They should not need to re-enter their links for every new server
- In a new server, they request activation of their saved profile

## Approval flow

- User saves creator profile once
- User requests activation in a specific guild
- Guild activation enters `pending`
- Admin/mod approves or disables it for that guild
- Only approved guild activations become active for posting

## Why this split exists

- users stay in Discord, where they already are
- admins keep stronger control in the website UI
- creators get a better long-term mobile path
- fewer permission mistakes
- easier scaling for large guild counts
- better long-term product clarity
- unpaid or expired guilds do not keep unrestricted Pro behavior
