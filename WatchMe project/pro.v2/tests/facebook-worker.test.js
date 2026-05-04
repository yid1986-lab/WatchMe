const assert = require("node:assert/strict");

const {
  buildFacebookApiUrl,
  buildFacebookPostLink,
  buildFacebookPostMessage,
  getFacebookConnectionAppId,
  isFacebookConnectionReady,
} = require("../apps/worker/src/facebook");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

run("buildFacebookApiUrl joins base, version, and path cleanly", () => {
  assert.equal(
    buildFacebookApiUrl(
      {
        facebookApiBaseUrl: "https://graph.facebook.com/",
        facebookGraphVersion: "/v22.0/",
      },
      "/123/feed"
    ),
    "https://graph.facebook.com/v22.0/123/feed"
  );
});

run("buildFacebookPostMessage trims and caps text", () => {
  const message = buildFacebookPostMessage({
    post_text: `  ${"a".repeat(7000)}  `,
  });

  assert.equal(message.length, 6000);
  assert.equal(message, "a".repeat(6000));
});

run("buildFacebookPostLink returns a normalized optional link", () => {
  assert.equal(
    buildFacebookPostLink({
      link_url: " https://watchme.example/post ",
    }),
    "https://watchme.example/post"
  );
  assert.equal(buildFacebookPostLink({}), null);
});

run("getFacebookConnectionAppId prefers connection metadata then env config", () => {
  assert.equal(
    getFacebookConnectionAppId(
      { facebookAppId: "env-app" },
      { metadata_json: { app_id: "meta-app" } }
    ),
    "meta-app"
  );
  assert.equal(
    getFacebookConnectionAppId(
      { facebookAppId: "env-app" },
      { metadata_json: {} }
    ),
    "env-app"
  );
});

run("isFacebookConnectionReady requires active status, account id, and access token", () => {
  assert.equal(
    isFacebookConnectionReady({
      status: "active",
      external_account_id: "page-1",
      access_token: "token-1",
    }),
    true
  );
  assert.equal(
    isFacebookConnectionReady({
      status: "inactive",
      external_account_id: "page-1",
      access_token: "token-1",
    }),
    false
  );
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
