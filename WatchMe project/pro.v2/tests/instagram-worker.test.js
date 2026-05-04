const assert = require("node:assert/strict");

const {
  buildInstagramApiUrl,
  buildInstagramCaption,
  getInstagramConnectionAppId,
  getInstagramPrimaryMediaUrl,
  isInstagramConnectionReady,
} = require("../apps/worker/src/instagram");

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

run("buildInstagramApiUrl supports versionless host URLs", () => {
  assert.equal(
    buildInstagramApiUrl(
      {
        instagramApiBaseUrl: "https://graph.instagram.com/",
        instagramGraphVersion: "",
      },
      "/123/media"
    ),
    "https://graph.instagram.com/123/media"
  );
});

run("buildInstagramCaption combines text and link", () => {
  assert.equal(
    buildInstagramCaption({
      post_text: "Creator post",
      link_url: "https://watchme.example/ig",
    }),
    "Creator post\n\nhttps://watchme.example/ig"
  );
});

run("getInstagramPrimaryMediaUrl prefers the first public media URL", () => {
  assert.equal(
    getInstagramPrimaryMediaUrl({
      media_urls_json: ["not-a-url", "https://cdn.example/image.jpg"],
    }),
    "https://cdn.example/image.jpg"
  );
});

run("getInstagramConnectionAppId prefers connection metadata then env config", () => {
  assert.equal(
    getInstagramConnectionAppId(
      { instagramAppId: "env-ig-app" },
      { metadata_json: { app_id: "meta-ig-app" } }
    ),
    "meta-ig-app"
  );
  assert.equal(
    getInstagramConnectionAppId(
      { instagramAppId: "env-ig-app" },
      { metadata_json: {} }
    ),
    "env-ig-app"
  );
});

run("isInstagramConnectionReady requires active status, account id, and access token", () => {
  assert.equal(
    isInstagramConnectionReady({
      status: "active",
      external_account_id: "ig-user-1",
      access_token: "token-1",
    }),
    true
  );
  assert.equal(
    isInstagramConnectionReady({
      status: "active",
      external_account_id: "ig-user-1",
      access_token: "",
    }),
    false
  );
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
