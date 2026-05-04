# Meta Social Connectors In V2

## Rule

Facebook and Instagram should be treated as separate providers in V2.

That means:
- separate login flows
- separate access tokens
- separate connection records
- separate publish handlers
- separate inbound grab logic

The only thing they should share is common infrastructure such as:
- `creator_social_connections`
- `creator_post_dispatches`
- `social_post_publications`
- shared retry, queue, and loop-prevention utilities

## Instagram requirement

Instagram must not depend on a linked Facebook Page in V2.

Meta's official Instagram Login documentation currently states:
- the Instagram API with Instagram Login "does not require a Facebook Page to be linked to the Instagram professional account"

It also exposes Instagram-specific scope values including:
- `instagram_business_basic`
- `instagram_business_content_publish`

So the correct V2 model is:
- Facebook connector for Facebook Pages
- Instagram connector for Instagram professional accounts
- no hard dependency that an Instagram account must be managed through a Facebook Page path

## Practical build rule

When we implement Instagram in V2:
- use a dedicated Instagram login/connect route
- store Instagram tokens under the `instagram` connection row
- publish through an Instagram-specific provider module
- keep Facebook page ids and Facebook page tokens out of the Instagram publish path

## Current state

Right now:
- Facebook outbound is the first real outbound social provider in V2
- Instagram outbound is also now implemented as its own provider slice
- Instagram publishing uses a separate Instagram connection row and token path
- the shared `social_post_publications` ledger records both Facebook and Instagram outbound origin receipts

That keeps the Meta build rule intact: shared infrastructure, but no dependency that Instagram posting must flow through a Facebook Page connector.

## Sources

- [Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login)
- [Instagram API with Instagram Login: Content Publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing)
