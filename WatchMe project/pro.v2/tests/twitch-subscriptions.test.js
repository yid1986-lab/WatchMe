const assert = require("node:assert/strict");

const { ensureStreamSubscriptions } = require("../apps/worker/src/twitch");

function jsonResponse(body, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    statusText: ok ? "OK" : "Bad Request",
    text: async () => JSON.stringify(body),
  };
}

async function main() {
  const calls = [];
  const originalFetch = global.fetch;
  const existing = [
    {
      id: "old-online",
      type: "stream.online",
      status: "enabled",
      condition: { broadcaster_user_id: "123" },
      transport: { callback: "https://pro.watchme-bot.com/twitch" },
    },
    {
      id: "old-offline",
      type: "stream.offline",
      status: "enabled",
      condition: { broadcaster_user_id: "123" },
      transport: { callback: "https://pro.watchme-bot.com/twitch" },
    },
  ];

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body || null });

    if (String(url).includes("oauth2/token")) {
      return jsonResponse({ access_token: "token", expires_in: 3600 });
    }

    if (String(url).includes("eventsub/subscriptions") && (options.method || "GET") === "GET") {
      return jsonResponse({ data: existing, pagination: {} });
    }

    if (String(url).includes("eventsub/subscriptions") && options.method === "DELETE") {
      return { ok: true, text: async () => "" };
    }

    if (String(url).includes("eventsub/subscriptions") && options.method === "POST") {
      const payload = JSON.parse(options.body);
      return jsonResponse({
        data: [{
          id: `new-${payload.type}`,
          type: payload.type,
          status: "webhook_callback_verification_pending",
          condition: payload.condition,
          transport: payload.transport,
        }],
      });
    }

    throw new Error(`Unexpected fetch ${options.method || "GET"} ${url}`);
  };

  try {
    const subscriptions = await ensureStreamSubscriptions({
      twitchClientId: "client",
      twitchClientSecret: "secret",
      twitchWebhookBaseUrl: "https://pro.watchme-bot.com",
      twitchWebhookPath: "/webhooks/twitch",
      twitchWebhookSecret: "webhook-secret",
      twitchPruneConflictingSubscriptions: true,
    }, "123");

    assert.equal(subscriptions["stream.online"].id, "new-stream.online");
    assert.equal(subscriptions["stream.offline"].id, "new-stream.offline");

    const deletedIds = calls
      .filter((call) => call.method === "DELETE")
      .map((call) => new URL(call.url).searchParams.get("id"));

    assert.deepEqual(deletedIds.sort(), ["old-offline", "old-online"]);
    console.log("PASS ensureStreamSubscriptions prunes conflicting Twitch callbacks during cutover");
  } finally {
    global.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error("FAIL ensureStreamSubscriptions prunes conflicting Twitch callbacks during cutover");
  console.error(error?.stack || error);
  process.exit(1);
});
