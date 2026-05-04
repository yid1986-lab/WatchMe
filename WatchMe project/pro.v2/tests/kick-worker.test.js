const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  buildKickSourceKey,
  extractKickBroadcasterId,
  parseKickSlug,
  verifyKickWebhookSignature,
} = require("../apps/worker/src/kick");

async function main() {
  assert.equal(buildKickSourceKey("123456789"), "kick:123456789");
  console.log("PASS buildKickSourceKey normalizes broadcaster IDs");

  assert.equal(extractKickBroadcasterId(buildKickSourceKey("123456789")), "123456789");
  console.log("PASS extractKickBroadcasterId handles normalized source keys");

  assert.equal(parseKickSlug("https://kick.com/WatchMeLive"), "watchmelive");
  console.log("PASS parseKickSlug handles Kick URLs");

  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  const rawBody = Buffer.from(JSON.stringify({
    broadcaster: {
      user_id: 123456789,
      channel_slug: "watchmelive",
    },
    is_live: true,
    title: "Stress stream",
    started_at: "2026-04-02T22:00:00Z",
    ended_at: null,
  }));
  const messageId = "kick-message-123";
  const timestamp = "2026-04-02T22:00:01Z";
  const signedPayload = Buffer.concat([
    Buffer.from(messageId, "utf8"),
    Buffer.from(".", "utf8"),
    Buffer.from(timestamp, "utf8"),
    Buffer.from(".", "utf8"),
    rawBody,
  ]);
  const signature = crypto.sign("RSA-SHA256", signedPayload, privateKey).toString("base64");

  const ok = await verifyKickWebhookSignature(
    {
      "Kick-Event-Signature": signature,
      "Kick-Event-Message-Id": messageId,
      "Kick-Event-Message-Timestamp": timestamp,
    },
    rawBody,
    {
      kickPublicKeyUrl: "",
    },
    publicKey.export({ type: "spki", format: "pem" }).toString()
  );

  assert.equal(ok, true);
  console.log("PASS verifyKickWebhookSignature accepts matching signatures");
}

main().catch((error) => {
  console.error("FAIL kick worker runtime");
  console.error(error?.stack || error);
  process.exit(1);
});
