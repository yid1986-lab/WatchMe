# Mobile Session Integration

Use this when wiring the website or a future creator/mobile client into `pro.v2` creator post-builder routes.

## Goal

Stop relying on one shared app token for creator/mobile routes.

Instead:

1. the website authenticates the user in its own login flow
2. the website calls `pro.v2` internal session issue route
3. `pro.v2` returns a signed user session for that Discord user
4. the client sends that signed session on creator/mobile route calls

## Internal session issue route

Route:

- `POST /api/internal/mobile-sessions`

Auth:

- `x-internal-token: <INTERNAL_API_TOKEN>`
  or
- `Authorization: Bearer <INTERNAL_API_TOKEN>`

Body:

```json
{
  "discord_user_id": "123456789012345678",
  "ttl_seconds": 3600
}
```

Response:

```json
{
  "ok": true,
  "session": {
    "discordUserId": "123456789012345678",
    "token": "<signed-session-token>",
    "expiresAt": "2026-04-09T12:34:56.000Z",
    "expiresAtSeconds": 1775738096,
    "expiresInSeconds": 3600,
    "issuedAt": "2026-04-09T11:34:56.000Z"
  }
}
```

## Client usage

Send the signed session on creator/mobile route calls:

```http
Authorization: Bearer <signed-session-token>
```

Current creator/mobile routes:

- `GET /api/mobile/creators/:discordUserId/post-builder`
- `PUT|POST /api/mobile/creators/:discordUserId/post-builder/templates`
- `PUT|POST /api/mobile/creators/:discordUserId/post-builder/connections/:platform`
- `POST /api/mobile/creators/:discordUserId/post-builder/publish`

Rule:

- the `:discordUserId` in the route must match the signed user in the session token

## Rollout mode

Current supported modes:

- fallback mode:
  - `MOBILE_SESSION_REQUIRED=false`
  - creator/mobile routes may still accept `MOBILE_API_WRITE_TOKEN`
- enforced signed-session mode:
  - `MOBILE_SESSION_REQUIRED=true`
  - creator/mobile routes require the signed user session

Recommended path:

1. wire the website to mint and forward signed sessions
2. prove the flow in staging
3. set `MOBILE_SESSION_REQUIRED=true`
4. remove reliance on the shared app-token fallback

## Env

- `INTERNAL_API_TOKEN`
- `MOBILE_SESSION_SECRET`
  fallback: `SESSION_SECRET`
- `MOBILE_SESSION_REQUIRED`
- `MOBILE_SESSION_TTL_SECONDS`

## Notes

- this session token is for creator/mobile routes only
- Lite guild routes still use Lite-scoped write auth
- internal ops and ingest routes still use internal auth
- do not expose `INTERNAL_API_TOKEN` in a browser client
