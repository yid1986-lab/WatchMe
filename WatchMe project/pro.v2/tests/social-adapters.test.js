const assert = require("node:assert/strict");

const {
  buildInstagramProfileUrl,
  inferInstagramContentType,
  normalizeInstagramMediaAdapterBody,
} = require("../apps/api/src/social-adapters");

async function main() {
  assert.equal(
    buildInstagramProfileUrl("@watchme_creator"),
    "https://instagram.com/watchme_creator"
  );
  console.log("PASS buildInstagramProfileUrl normalizes usernames");

  const normalized = normalizeInstagramMediaAdapterBody({
    account_id: "ig-user-1",
    username: "watchme_creator",
    external_app_id: "meta-app-1",
    media_item: {
      id: "ig-post-1",
      caption: "Creator just posted",
      permalink: "https://instagram.com/p/ig-post-1",
      media_url: "https://cdn.watchme.example/ig-post-1.jpg",
      timestamp: "2026-04-03T14:00:00.000Z",
      media_type: "IMAGE",
      media_product_type: "FEED",
      children: [
        {
          media_url: "https://cdn.watchme.example/ig-post-1-child.jpg",
        },
      ],
    },
  });

  assert.equal(normalized.platform, "instagram");
  assert.equal(normalized.external_account_id, "ig-user-1");
  assert.equal(normalized.external_account_name, "watchme_creator");
  assert.equal(normalized.external_account_handle, "@watchme_creator");
  assert.equal(normalized.external_post_id, "ig-post-1");
  assert.equal(normalized.external_post_url, "https://instagram.com/p/ig-post-1");
  assert.equal(normalized.source_url, "https://instagram.com/watchme_creator");
  assert.equal(normalized.ingested_via, "instagram_inbound_adapter");
  assert.equal(normalized.media_type, "IMAGE");
  assert.equal(normalized.media_product_type, "FEED");
  assert.equal(normalized.content_type, "image");
  assert.equal(normalized.content_label, "Image");
  assert.deepEqual(normalized.media_urls_json, [
    "https://cdn.watchme.example/ig-post-1.jpg",
    "https://cdn.watchme.example/ig-post-1-child.jpg",
  ]);
  assert.equal(normalized.metadata_json.provider, "instagram_graph");
  assert.equal(normalized.metadata_json.adapter, "instagram_media");
  assert.equal(normalized.metadata_json.content_type, "image");
  console.log("PASS normalizeInstagramMediaAdapterBody maps media payloads into social ingest shape");

  const reelContent = inferInstagramContentType("VIDEO", "REELS");
  assert.equal(reelContent.contentType, "reel");
  assert.equal(reelContent.contentLabel, "Reel");
  console.log("PASS inferInstagramContentType distinguishes reels from generic video");

  assert.throws(
    () => normalizeInstagramMediaAdapterBody({ media_item: { id: "ig-post-2" } }),
    /external_account_id, account_id, or instagram_account_id is required/
  );
  console.log("PASS normalizeInstagramMediaAdapterBody requires an account id");
}

main().catch((error) => {
  console.error("FAIL social adapter coverage");
  console.error(error?.stack || error);
  process.exit(1);
});
