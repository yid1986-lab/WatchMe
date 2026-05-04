const assert = require("node:assert/strict");

const { dedupeDueSubscriptions, runJobsWithConcurrency } = require("../apps/worker/src/runner");

async function main() {
  let active = 0;
  let maxActive = 0;
  const visited = [];
  const jobs = Array.from({ length: 8 }, (_, index) => ({ index }));

  await runJobsWithConcurrency(jobs, 3, async (job) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    visited.push(job.index);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
  });

  assert.equal(maxActive <= 3, true);
  assert.deepEqual(visited.slice().sort((a, b) => a - b), jobs.map((job) => job.index));
  console.log("PASS runJobsWithConcurrency respects the requested parallelism");

  const due = dedupeDueSubscriptions([
    {
      subscription_id: 1,
      platform: "twitch",
      topic_key: "twitch:123",
      callback_url: "https://pro.watchme-bot.com/webhooks/twitch",
      metadata_json: {},
    },
    {
      subscription_id: 2,
      platform: "twitch",
      topic_key: "twitch:123",
      callback_url: "https://pro.watchme-bot.com/webhooks/twitch",
      metadata_json: {},
    },
    {
      subscription_id: 3,
      platform: "twitch",
      topic_key: "twitch:login",
      callback_url: "https://pro.watchme-bot.com/webhooks/twitch",
      metadata_json: { canonicalTopicKey: "twitch:123" },
    },
    {
      subscription_id: 4,
      platform: "youtube",
      topic_key: "youtube:UC123",
      callback_url: "https://pro.watchme-bot.com/webhooks/youtube",
      metadata_json: {},
    },
  ]);

  assert.deepEqual(
    due.map((row) => row.subscription_id),
    [1, 4]
  );
  console.log("PASS dedupeDueSubscriptions queues one renewal per provider topic");
}

main().catch((error) => {
  console.error("FAIL runJobsWithConcurrency respects the requested parallelism");
  console.error(error?.stack || error);
  process.exit(1);
});
