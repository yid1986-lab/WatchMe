# Lite V2 User Journey

## Goal

Make Lite feel simple, quiet, and clear for admins and moderators.

## Journey

1. Admin opens WatchMe Lite in Discord
2. WatchMe shows a clean control panel with Twitch and YouTube options
3. Admin submits one or more supported links
4. If no valid links are included:
   - show a clean warning
   - tell them Lite only supports Twitch and YouTube
5. If the server has already reached 5 creators:
   - block the submission
   - show upgrade prompt
   - link to Pro
6. If under the cap:
   - save submission
   - show success immediately
   - do not spam the server with extra onboarding messages

## UX principles

- no noisy welcome posts
- no messy multi-step wizard unless it clearly helps
- support only the platforms Lite really promises
- clear upgrade moment only when the server limit is hit
- keep Lite inside Discord and away from the web UI
