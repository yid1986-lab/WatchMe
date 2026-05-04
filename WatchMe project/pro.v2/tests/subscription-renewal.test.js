const assert = require("node:assert/strict");

const {
  getRenewablePlatforms,
  hasFutureLease,
  isPlatformRenewalSupported,
  shouldSkipProviderRenewal,
} = require("../apps/worker/src/subscription-renewal");

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

run("getRenewablePlatforms only returns configured connectors", () => {
  const config = {
    twitchClientId: "twitch-id",
    twitchClientSecret: "twitch-secret",
    twitchWebhookBaseUrl: "https://worker.example",
    twitchWebhookSecret: "secret",
    youtubeApiKey: "youtube-key",
    youtubeWebhookBaseUrl: "https://worker.example",
    kickClientId: "",
    kickClientSecret: "",
    kickWebhookBaseUrl: "",
  };

  assert.deepEqual(getRenewablePlatforms(config), ["twitch", "youtube"]);
});

run("isPlatformRenewalSupported rejects incomplete connectors", () => {
  assert.equal(
    isPlatformRenewalSupported("kick", {
      kickClientId: "kick-id",
      kickClientSecret: "",
      kickWebhookBaseUrl: "https://worker.example",
    }),
    false
  );
});

run("hasFutureLease detects leases beyond the lead window", () => {
  const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  assert.equal(hasFutureLease(future, 60), true);
  assert.equal(hasFutureLease(future, 60 * 60), false);
});

run("shouldSkipProviderRenewal only skips active canonical rows with healthy leases", () => {
  const leaseExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  assert.equal(
    shouldSkipProviderRenewal(
      {
        status: "active",
        topic_key: "kick:12345",
        callback_url: "https://worker.example/webhooks/kick",
        lease_expires_at: leaseExpiresAt,
      },
      {
        canonicalTopicKey: "kick:12345",
        callbackUrl: "https://worker.example/webhooks/kick",
        leadSeconds: 300,
      }
    ),
    true
  );

  assert.equal(
    shouldSkipProviderRenewal(
      {
        status: "active",
        topic_key: "kick:legacyslug",
        callback_url: "https://worker.example/webhooks/kick",
        lease_expires_at: leaseExpiresAt,
      },
      {
        canonicalTopicKey: "kick:12345",
        callbackUrl: "https://worker.example/webhooks/kick",
        leadSeconds: 300,
      }
    ),
    false
  );
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
