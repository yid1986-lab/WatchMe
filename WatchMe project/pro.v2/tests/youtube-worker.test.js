const assert = require("node:assert/strict");

const {
  buildYouTubeSourceKey,
  extractYouTubeChannelId,
  isYouTubeLiveVideo,
  parseFeedEntries,
  parseYouTubeHandleFromUrl,
} = require("../apps/worker/src/youtube");

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

run("buildYouTubeSourceKey keeps canonical channel casing", () => {
  assert.equal(
    buildYouTubeSourceKey("UC_x5XG1OV2P6uZZ5FSM9Ttw"),
    "youtube:UC_x5XG1OV2P6uZZ5FSM9Ttw"
  );
});

run("extractYouTubeChannelId handles feed topics and source keys", () => {
  assert.equal(
    extractYouTubeChannelId("youtube:https://www.youtube.com/xml/feeds/videos.xml?channel_id=UC_x5XG1OV2P6uZZ5FSM9Ttw"),
    "UC_x5XG1OV2P6uZZ5FSM9Ttw"
  );
});

run("parseYouTubeHandleFromUrl supports handle URLs", () => {
  assert.equal(
    parseYouTubeHandleFromUrl("https://www.youtube.com/@WatchMeLive"),
    "WatchMeLive"
  );
});

run("parseFeedEntries extracts Atom notification entries", () => {
  const entries = parseFeedEntries(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <link rel="hub" href="https://pubsubhubbub.appspot.com" />
  <link rel="self" href="https://www.youtube.com/xml/feeds/videos.xml?channel_id=UC_x5XG1OV2P6uZZ5FSM9Ttw" />
  <title>YouTube video feed</title>
  <updated>2026-04-02T10:00:00+00:00</updated>
  <entry>
    <id>yt:video:abc123xyz89</id>
    <yt:videoId>abc123xyz89</yt:videoId>
    <yt:channelId>UC_x5XG1OV2P6uZZ5FSM9Ttw</yt:channelId>
    <title>Live now</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc123xyz89"/>
    <author>
      <name>WatchMe Live</name>
      <uri>https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw</uri>
    </author>
    <published>2026-04-02T09:59:00+00:00</published>
    <updated>2026-04-02T10:00:00+00:00</updated>
  </entry>
</feed>`);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].videoId, "abc123xyz89");
  assert.equal(entries[0].channelId, "UC_x5XG1OV2P6uZZ5FSM9Ttw");
  assert.equal(entries[0].channelTitle, "WatchMe Live");
});

run("isYouTubeLiveVideo accepts active live payloads", () => {
  assert.equal(
    isYouTubeLiveVideo({
      liveBroadcastContent: "live",
      actualStartTime: "2026-04-02T10:00:00Z",
      actualEndTime: null,
    }),
    true
  );
});

run("isYouTubeLiveVideo rejects ended streams", () => {
  assert.equal(
    isYouTubeLiveVideo({
      liveBroadcastContent: "none",
      actualStartTime: "2026-04-02T10:00:00Z",
      actualEndTime: "2026-04-02T12:00:00Z",
    }),
    false
  );
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
