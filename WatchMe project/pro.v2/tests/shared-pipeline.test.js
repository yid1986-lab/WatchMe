const assert = require("node:assert/strict");

const {
  buildEventDedupeKey,
  buildLiveSessionKey,
  buildPlatformTopicKey,
  extractSocialOriginMarkers,
  buildSocialOriginFingerprint,
  buildSocialOriginKey,
  canRunPlatformForEntitlement,
  ENTITLEMENT_STATUSES,
  isLiveEventType,
} = require("../packages/shared/src");

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

run("buildPlatformTopicKey prefers stable external IDs", () => {
  assert.equal(
    buildPlatformTopicKey({
      platform: "Twitch",
      externalId: "479277594",
      url: "https://twitch.tv/watchme",
    }),
    "twitch:479277594"
  );
});

run("buildPlatformTopicKey falls back to normalized URL", () => {
  assert.equal(
    buildPlatformTopicKey({
      platform: "YouTube",
      url: " HTTPS://youtube.com/@WatchMe ",
    }),
    "youtube:https://youtube.com/@watchme"
  );
});

run("buildPlatformTopicKey preserves canonical YouTube channel IDs", () => {
  assert.equal(
    buildPlatformTopicKey({
      platform: "YouTube",
      externalId: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
    }),
    "youtube:UC_x5XG1OV2P6uZZ5FSM9Ttw"
  );
});

run("inactive entitlements still allow lite-safe live platforms", () => {
  const result = canRunPlatformForEntitlement("twitch", ENTITLEMENT_STATUSES.INACTIVE);
  assert.equal(result.allowed, true);
  assert.equal(result.mode, "lite");
});

run("inactive entitlements block pro-only live platforms", () => {
  const result = canRunPlatformForEntitlement("kick", ENTITLEMENT_STATUSES.INACTIVE);
  assert.equal(result.allowed, false);
});

run("grace period keeps pro-only platforms active", () => {
  const result = canRunPlatformForEntitlement("kick", ENTITLEMENT_STATUSES.GRACE_PERIOD);
  assert.equal(result.allowed, true);
  assert.equal(result.mode, "pro");
});

run("buildEventDedupeKey stays stable across casing differences", () => {
  const a = buildEventDedupeKey({
    platform: "Twitch",
    eventType: "STREAM.ONLINE",
    sourceKey: "TWITCH:479277594",
    providerEventId: "evt_1",
    sourceCreatedAt: "2026-04-02T10:00:00.000Z",
  });
  const b = buildEventDedupeKey({
    platform: "twitch",
    eventType: "stream.online",
    sourceKey: "twitch:479277594",
    providerEventId: "evt_1",
    sourceCreatedAt: "2026-04-02t10:00:00.000z",
  });

  assert.equal(a, b);
});

run("buildLiveSessionKey prefers provider event identity", () => {
  assert.equal(
    buildLiveSessionKey({
      platform: "youtube",
      sourceKey: "youtube:abc123",
      sourceExternalId: "abc123",
      providerEventId: "evt_9000",
      sourceCreatedAt: "2026-04-02T10:00:00.000Z",
      eventType: "live_started",
    }),
    "youtube:youtube:abc123:evt_9000:2026-04-02t10:00:00.000z"
  );
});

run("isLiveEventType recognizes supported live markers", () => {
  assert.equal(isLiveEventType("stream.online"), true);
  assert.equal(isLiveEventType("live_started"), true);
  assert.equal(isLiveEventType("post.created"), false);
});

run("buildSocialOriginKey is stable for a dispatch target", () => {
  assert.equal(
    buildSocialOriginKey({
      platform: "Instagram",
      dispatchId: 42,
    }),
    "wm-origin:v1:instagram:42"
  );
});

run("buildSocialOriginFingerprint is deterministic per origin and connection", () => {
  const originKey = buildSocialOriginKey({
    platform: "x",
    dispatchId: "dispatch-9000",
  });

  const a = buildSocialOriginFingerprint({
    originKey,
    discordUserId: "User-123",
    connectionId: 77,
  });
  const b = buildSocialOriginFingerprint({
    originKey,
    discordUserId: "user-123",
    connectionId: "77",
  });
  const c = buildSocialOriginFingerprint({
    originKey,
    discordUserId: "user-123",
    connectionId: 78,
  });

  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^wmf1_[0-9a-f]{24}$/);
});

run("extractSocialOriginMarkers finds origin keys and fingerprints in mixed text", () => {
  const markers = extractSocialOriginMarkers([
    "Posted by WatchMe wm-origin:v1:instagram:42",
    "metadata has WMF1_0123456789ABCDEF01234567 inside it",
    "duplicate marker wm-origin:v1:instagram:42",
  ]);

  assert.deepEqual(markers.originKeys, ["wm-origin:v1:instagram:42"]);
  assert.deepEqual(markers.originFingerprints, ["wmf1_0123456789abcdef01234567"]);
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
