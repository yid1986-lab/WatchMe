const { getWorkerConfig } = require("./config");
const { handleJob } = require("./handlers");
const { log } = require("./logger");
const { getRenewablePlatforms } = require("./subscription-renewal");
const {
  getRuntimeSnapshot,
  noteJobCompleted,
  noteJobFailed,
  noteJobsClaimed,
  noteRunnerStart,
  noteStaleLocksReleased,
  noteSubscriptionSweep,
  noteTickEnd,
  noteTickStart,
} = require("./runtime");
const {
  enqueuePlatformSubscriptionRenewalJob,
  getPlatformSubscriptionsDueForRenewal,
  markWorkerHeartbeatStopped,
  upsertWorkerHeartbeat,
} = require("./store");
const { claimJobs, completeJob, failJob, releaseStaleLocks } = require("./queue");

let timer = null;
let heartbeatTimer = null;
let running = false;
let lastSubscriptionSweepAt = 0;
let heartbeatInFlight = null;
let pendingHeartbeatStatus = null;
const SUBSCRIPTION_SWEEP_INTERVAL_MS = 60 * 1000;
const SUBSCRIPTION_SWEEP_LEAD_SECONDS = 30 * 60;
const SUBSCRIPTION_SWEEP_LIMIT = 100;

function dedupeDueSubscriptions(rows = []) {
  const seen = new Set();
  const deduped = [];

  for (const row of rows) {
    const metadata = row.metadata_json || {};
    const key = [
      String(row.platform || "").trim().toLowerCase(),
      String(metadata.canonicalTopicKey || row.topic_key || "").trim().toLowerCase(),
      String(row.callback_url || "").trim().toLowerCase(),
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

async function processJob(job) {
  try {
    await handleJob(job);
    await completeJob(job.job_id);
    noteJobCompleted();
  } catch (error) {
    const message = error?.message || String(error);
    log("error", "queue", `Job ${job.job_id} failed: ${message}`);
    noteJobFailed(job, message);
    await failJob(job, message);
  }
}

async function runJobsWithConcurrency(jobs, concurrency, processFn = processJob) {
  const limit = Math.max(1, Number(concurrency || 1));
  if (!jobs.length) {
    return;
  }

  let nextIndex = 0;

  async function workerLoop() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= jobs.length) {
        return;
      }

      await processFn(jobs[index]);
    }
  }

  const workerCount = Math.min(limit, jobs.length);
  await Promise.all(Array.from({ length: workerCount }, () => workerLoop()));
}

async function sweepDuePlatformSubscriptions(config) {
  if (!config.queues.includes("platform_subscription")) {
    return;
  }

  const now = Date.now();
  if (now - lastSubscriptionSweepAt < SUBSCRIPTION_SWEEP_INTERVAL_MS) {
    return;
  }
  lastSubscriptionSweepAt = now;

  const renewablePlatforms = new Set(getRenewablePlatforms(config));
  if (!renewablePlatforms.size) {
    noteSubscriptionSweep(0);
    return;
  }

  const dueSubscriptions = dedupeDueSubscriptions(await getPlatformSubscriptionsDueForRenewal(
    SUBSCRIPTION_SWEEP_LEAD_SECONDS,
    SUBSCRIPTION_SWEEP_LIMIT
  )).filter((row) => renewablePlatforms.has(String(row.platform || "").trim().toLowerCase()));

  for (const row of dueSubscriptions) {
    const metadata = row.metadata_json || {};
    const scope = String(metadata.scope || "").trim().toLowerCase() === "lite"
      ? "lite"
      : (row.guild_id ? "guild" : "creator");

    await enqueuePlatformSubscriptionRenewalJob({
      subscriptionId: row.subscription_id,
      platform: row.platform,
      topicKey: row.topic_key,
      guildId: row.guild_id || row.creator_guild_id || null,
      discordUserId: row.creator_discord_user_id || null,
      scope,
      metadata,
    });
  }

  noteSubscriptionSweep(dueSubscriptions.length);
  if (dueSubscriptions.length) {
    log("info", "runner", `Queued ${dueSubscriptions.length} due platform subscription renewal job(s)`);
  }
}

async function tick() {
  if (running) return;
  running = true;
  let tickFinished = false;

  const config = getWorkerConfig();

  try {
    noteTickStart();
    persistWorkerHeartbeat("running").catch(() => null);
    await sweepDuePlatformSubscriptions(config);
    const releasedLocks = await releaseStaleLocks(config.lockTimeoutSeconds);
    noteStaleLocksReleased(releasedLocks);
    const jobs = await claimJobs(config.workerName, config.batchSize, config.queues);
    noteJobsClaimed(jobs.length);

    if (jobs.length) {
      log("info", "queue", `Claimed ${jobs.length} job(s)`);
    }

    await runJobsWithConcurrency(jobs, Math.min(config.batchSize, config.concurrency));
  } catch (error) {
    log("error", "runner", `Tick failed: ${error?.message || error}`);
    noteTickEnd(error);
    persistWorkerHeartbeat("running").catch(() => null);
    tickFinished = true;
  } finally {
    if (!tickFinished) {
      noteTickEnd();
    }
    persistWorkerHeartbeat("running").catch(() => null);
    running = false;
  }
}

async function persistWorkerHeartbeat(status = "running") {
  const requestedStatus = String(status || "running").trim().toLowerCase() || "running";

  if (heartbeatInFlight) {
    if (requestedStatus === "stopped") {
      pendingHeartbeatStatus = "stopped";
    } else if (!pendingHeartbeatStatus) {
      pendingHeartbeatStatus = "running";
    }
    return heartbeatInFlight;
  }

  heartbeatInFlight = (async () => {
    let nextStatus = requestedStatus;

    while (true) {
      const snapshot = getRuntimeSnapshot();

      if (nextStatus === "stopped") {
        await markWorkerHeartbeatStopped(snapshot.workerName, snapshot);
      } else {
        await upsertWorkerHeartbeat(snapshot, {
          status: nextStatus,
        });
      }

      if (!pendingHeartbeatStatus) {
        break;
      }

      nextStatus = pendingHeartbeatStatus;
      pendingHeartbeatStatus = null;
    }
  })();

  try {
    await heartbeatInFlight;
  } finally {
    heartbeatInFlight = null;
  }
}

function startRunner() {
  const config = getWorkerConfig();
  noteRunnerStart(config);
  log(
    "info",
    "runner",
    `Worker ${config.workerName} starting in ${config.nodeEnv} with poll interval ${config.pollIntervalMs}ms for queues ${config.queues.join(", ")}`
  );

  persistWorkerHeartbeat("running").catch((error) => {
    log("error", "runner", `Initial heartbeat failed: ${error?.message || error}`);
  });

  tick().catch(() => null);
  timer = setInterval(() => {
    tick().catch(() => null);
  }, config.pollIntervalMs);

  heartbeatTimer = setInterval(() => {
    persistWorkerHeartbeat("running").catch((error) => {
      log("error", "runner", `Heartbeat update failed: ${error?.message || error}`);
    });
  }, Math.max(1000, Number(config.heartbeatIntervalMs || 15000)));
}

function stopRunner() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  return persistWorkerHeartbeat("stopped").catch((error) => {
    log("error", "runner", `Stop heartbeat failed: ${error?.message || error}`);
  });
}

module.exports = {
  dedupeDueSubscriptions,
  getRenewablePlatforms,
  runJobsWithConcurrency,
  startRunner,
  stopRunner,
};
