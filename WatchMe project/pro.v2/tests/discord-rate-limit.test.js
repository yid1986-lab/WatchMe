const assert = require("node:assert/strict");

const {
  buildLiveMessagePayload,
  buildSocialFeedMessagePayload,
  buildDiscordApiUrl,
  doesMessageMatchPayload,
  getDiscordRetryDelayMs,
  sendChannelMessage,
} = require("../apps/worker/src/discord");

function createResponse(headers = {}) {
  return {
    headers: {
      get(name) {
        const key = String(name || "").toLowerCase();
        return headers[key] || null;
      },
    },
  };
}

async function main() {
  assert.equal(
    buildDiscordApiUrl("/channels/123/messages", "https://discord.com/api/v10"),
    "https://discord.com/api/v10/channels/123/messages"
  );
  console.log("PASS buildDiscordApiUrl joins API paths cleanly");

  assert.equal(
    getDiscordRetryDelayMs(createResponse(), { retry_after: 1.25 }, 1, 1000),
    1250
  );
  console.log("PASS getDiscordRetryDelayMs prefers body retry_after");

  assert.equal(
    getDiscordRetryDelayMs(createResponse({ "x-ratelimit-reset-after": "2.5" }), {}, 1, 1000),
    2500
  );
  console.log("PASS getDiscordRetryDelayMs reads Discord reset headers");

  assert.equal(
    getDiscordRetryDelayMs(createResponse(), {}, 3, 500),
    2000
  );
  console.log("PASS getDiscordRetryDelayMs falls back to exponential backoff");

  const payload = buildLiveMessagePayload({
    platform: "twitch",
    sourceCreatedAt: "2026-04-03T12:00:00Z",
    payload: {
      broadcaster_user_name: "WatchMe",
      source_url: "https://www.twitch.tv/watchme",
      title: "Road to rank 1",
      started_at: "2026-04-03T12:00:00Z",
    },
  });
  assert.equal(payload.embeds[0].timestamp, "2026-04-03T12:00:00Z");
  console.log("PASS buildLiveMessagePayload uses the event start time for deterministic timestamps");

  const socialPayload = buildSocialFeedMessagePayload({
    platform: "instagram",
    brandName: "WatchMe",
    payload: {
      creator_display_name: "WatchMe Creator",
      external_account_name: "WatchMe Insta",
      external_account_handle: "@watchmeinsta",
      external_post_url: "https://instagram.com/p/manual-post",
      normalized_text: "Manual social post body",
      media_urls_json: ["https://cdn.watchme.example/manual-post.jpg"],
      content_label: "Reel",
      media_product_type: "REELS",
      published_at: "2026-04-03T13:00:00Z",
    },
  });
  assert.equal(socialPayload.embeds[0].title, "WatchMe Creator posted on Instagram");
  assert.equal(socialPayload.embeds[0].url, "https://instagram.com/p/manual-post");
  assert.equal(socialPayload.embeds[0].image.url, "https://cdn.watchme.example/manual-post.jpg");
  assert.equal(
    socialPayload.embeds[0].fields.some((field) => field.name === "Type" && field.value === "Reel"),
    true
  );
  assert.equal(
    socialPayload.embeds[0].fields.some((field) => field.name === "Surface" && field.value === "Reels"),
    true
  );
  console.log("PASS buildSocialFeedMessagePayload builds a deterministic social feed embed");

  assert.equal(
    doesMessageMatchPayload(
      {
        id: "message-1",
        content: payload.content,
        embeds: payload.embeds,
      },
      payload
    ),
    true
  );
  console.log("PASS doesMessageMatchPayload recognizes a previously sent live alert");

  const originalFetch = global.fetch;
  let fetchAttempts = 0;
  global.fetch = async () => {
    fetchAttempts += 1;
    if (fetchAttempts === 1) {
      throw new Error("fetch failed");
    }

    return {
      ok: true,
      text: async () => JSON.stringify({ id: "message-1" }),
    };
  };

  try {
    const result = await sendChannelMessage(
      "123",
      "discord-token",
      { content: "WatchMe retry" },
      {
        apiBaseUrl: "https://discord.com/api/v10",
        maxRetries: 1,
        baseRetryMs: 1,
      }
    );

    assert.equal(fetchAttempts, 2);
    assert.equal(result.id, "message-1");
  } finally {
    global.fetch = originalFetch;
  }
  console.log("PASS sendChannelMessage retries transient fetch failures before surfacing an error");
}

main().catch((error) => {
  console.error("FAIL discord rate limit coverage");
  console.error(error?.stack || error);
  process.exit(1);
});
