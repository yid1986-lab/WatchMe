# pro.v2: Secure Discord Dashboard/Admin Controls

## Scope

Write root: `WatchMe project/pro.v2`

## Goal

Ensure Discord dashboard/admin controls are visible and writable only for users who have the correct manage/admin permission for that specific guild.

## Background

There has been a cross-guild access risk: a user may see or adjust another Discord server's admin settings. This must be fixed before wider testing.

## Acceptance Criteria

- Admin/config endpoints verify the authenticated Discord user can manage the target guild.
- Discord bot buttons/menus enforce the same guild permission checks.
- Non-admin users cannot read or write another guild's channels, creators, branding, live roles, or socials.
- Add focused tests for allowed and denied access.
- Run:

```powershell
cd "WatchMe project/pro.v2"
npm run check
npm test
```

## Boundaries

- Do not touch `lite.v2`.
- Do not use V1 roots as write targets.
- Do not commit env files or secrets.

