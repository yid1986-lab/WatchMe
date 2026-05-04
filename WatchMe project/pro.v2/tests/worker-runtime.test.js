const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  buildLiveMessagePayload,
  buildMentionContent,
} = require("../apps/worker/src/discord");
const { validateWorkerConfig } = require("../apps/worker/src/config");
const {
  buildTwitchSourceKey,
  extractTwitchBroadcasterId,
  parseTwitchLogin,
  verifyEventSubSignature,
} = require("../apps/worker/src/twitch");
const {
  buildLivePostDedupeKey,
  buildScopedLiveSessionKey,
  normalizeProductScope,
} = require("../apps/worker/src/store");

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

run("parseTwitchLogin handles full URLs", () => {
  assert.equal(parseTwitchLogin("https://www.twitch.tv/WatchMeBot"), "watchmebot");
});

run("extractTwitchBroadcasterId handles normalized source keys", () => {
  assert.equal(extractTwitchBroadcasterId(buildTwitchSourceKey("479277594")), "479277594");
});

run("verifyEventSubSignature accepts matching signatures", () => {
  const secret = "super-secret-key";
  const rawBody = Buffer.from(JSON.stringify({ hello: "world" }));
  const messageId = "message-123";
  const timestamp = "2026-04-02T11:00:00Z";
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(messageId + timestamp);
  hmac.update(rawBody);
  const signature = `sha256=${hmac.digest("hex")}`;

  assert.equal(
    verifyEventSubSignature(
      {
        "Twitch-Eventsub-Message-Id": messageId,
        "Twitch-Eventsub-Message-Timestamp": timestamp,
        "Twitch-Eventsub-Message-Signature": signature,
      },
      rawBody,
      secret
    ),
    true
  );
});

run("verifyEventSubSignature rejects requests when the secret is missing", () => {
  assert.equal(
    verifyEventSubSignature(
      {
        "Twitch-Eventsub-Message-Id": "message-123",
        "Twitch-Eventsub-Message-Timestamp": "2026-04-02T11:00:00Z",
        "Twitch-Eventsub-Message-Signature": "sha256=ignored",
      },
      Buffer.from("{}"),
      ""
    ),
    false
  );
});

run("validateWorkerConfig requires a non-default YouTube webhook path in production", () => {
  const result = validateWorkerConfig({
    nodeEnv: "production",
    databaseUrl: "postgres://watchme:test@127.0.0.1:5432/watchme_v2",
    internalApiToken: "internal-token",
    discordBotToken: "discord-token",
    twitchWebhookBaseUrl: "",
    twitchWebhookSecret: "",
    youtubeWebhookBaseUrl: "https://pro.watchme-bot.com",
    youtubeWebhookPath: "/webhooks/youtube",
  });

  assert.ok(
    result.errors.some((error) => error.includes("YOUTUBE_WEBHOOK_PATH must be changed from the default"))
  );
});

run("buildMentionContent respects mention mode", () => {
  assert.equal(
    buildMentionContent({
      mentionMode: "both",
      liveRoleId: "role-1",
      creatorDiscordUserId: "user-1",
    }),
    "<@user-1> <@&role-1>"
  );
});

run("buildLiveMessagePayload creates the live embed layout and mention controls", () => {
  const payload = buildLiveMessagePayload({
    platform: "twitch",
    mentionMode: "role",
    liveRoleId: "role-9",
    brandName: "WatchMe Pro",
    footerText: "Stay notified",
    guildIconUrl: "https://example.com/guild.png",
    payload: {
      broadcaster_user_name: "Dan",
      broadcaster_user_login: "danstreams",
      title: "Road to rank 1",
      game_name: "EA FC",
      viewer_count: 42,
      thumbnail_url: "https://example.com/preview.jpg",
    },
  });

  assert.equal(payload.content, "<@&role-9>");
  assert.equal(payload.embeds[0].author.name, "Dan is LIVE on Twitch");
  assert.equal(payload.embeds[0].author.icon_url, "https://example.com/guild.png");
  assert.equal(payload.embeds[0].title, "Road to rank 1");
  assert.equal(payload.embeds[0].description, "https://www.twitch.tv/danstreams\nGame: EA FC");
  assert.deepEqual(payload.embeds[0].fields, [
    {
      name: "Viewers",
      value: "42",
      inline: true,
    },
  ]);
  assert.equal(payload.allowed_mentions.roles[0], "role-9");
});

run("Lite live posts get a separate delivery scope and session key", () => {
  assert.equal(normalizeProductScope("lite"), "lite");
  assert.equal(buildScopedLiveSessionKey("twitch:123:stream-1", "lite"), "lite:twitch:123:stream-1");
  assert.equal(buildScopedLiveSessionKey("twitch:123:stream-1", "creator"), "twitch:123:stream-1");
  assert.equal(
    buildLivePostDedupeKey({
      productScope: "lite",
      guildId: "guild-1",
      platform: "twitch",
      sessionKey: "lite:twitch:123:stream-1",
    }),
    "live:lite:guild-1:twitch:lite:twitch:123:stream-1"
  );
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
