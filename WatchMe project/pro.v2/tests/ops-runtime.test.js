const assert = require("node:assert/strict");

const {
  buildOpsWarnings,
  buildQueueBreakdown,
  buildSocialFeedOpsSummary,
} = require("../apps/api/src/queries");
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
  resetRuntimeState,
} = require("../apps/worker/src/runtime");

async function main() {
  resetRuntimeState();

  noteRunnerStart({
    workerName: "watchme-v2-test-worker",
    nodeEnv: "test",
    queues: ["platform_ingest", "live_post"],
    pollIntervalMs: 50,
    batchSize: 10,
    concurrency: 4,
    lockTimeoutSeconds: 120,
  });
  noteTickStart();
  noteJobsClaimed(3);
  noteJobCompleted();
  noteJobFailed(
    {
      job_id: 99,
      queue_name: "platform_ingest",
      job_type: "process_live_event",
      attempts: 2,
    },
    "boom"
  );
  noteStaleLocksReleased(2);
  noteSubscriptionSweep(7);
  noteTickEnd();

  const snapshot = getRuntimeSnapshot();
  assert.equal(snapshot.workerName, "watchme-v2-test-worker");
  assert.equal(snapshot.totalJobsClaimed, 3);
  assert.equal(snapshot.totalJobsCompleted, 1);
  assert.equal(snapshot.totalJobsFailed, 1);
  assert.equal(snapshot.totalStaleLocksReleased, 2);
  assert.equal(snapshot.lastSubscriptionSweepCount, 7);
  assert.equal(snapshot.recentFailures.length, 1);
  assert.equal(snapshot.recentFailures[0].jobId, 99);
  assert.equal(snapshot.tickInProgress, false);
  assert.equal(snapshot.process.pid > 0, true);
  assert.equal(snapshot.process.sampleCount > 0, true);
  assert.equal(snapshot.process.maxRssBytes >= snapshot.process.rssBytes, true);
  assert.equal(snapshot.process.maxHeapUsedBytes >= snapshot.process.heapUsedBytes, true);
  console.log("PASS worker runtime snapshot tracks queue activity");

  const warnings = buildOpsWarnings(
    {
      jobs: {
        ready: 4,
        processing: 2,
        failed: 1,
        staleLocks: 2,
        oldestReadyAgeSeconds: 900,
      },
      ingest: {
        backlog: 3,
        oldestBacklogAgeSeconds: 700,
      },
      subscriptions: {
        expired: 1,
        dueSoon: 5,
        revoked: 2,
      },
    },
    {
      lockTimeoutSeconds: 120,
      backlogWarningSeconds: 300,
      leaseWarningSeconds: 3600,
    }
  );

  assert.equal(warnings.some((warning) => warning.code === "stale_job_locks"), true);
  assert.equal(warnings.some((warning) => warning.code === "job_backlog"), true);
  assert.equal(warnings.some((warning) => warning.code === "expired_subscriptions"), true);
  console.log("PASS ops warnings flag backlog and subscription risk states");

  const queueBreakdown = buildQueueBreakdown([
    {
      queue_name: "social_feed",
      status: "pending",
      count: 4,
      oldest_available_at: "2026-04-03T12:00:00.000Z",
      max_attempts: 3,
      error_count: 1,
    },
    {
      queue_name: "social_feed",
      status: "processing",
      count: 2,
      oldest_available_at: "2026-04-03T12:01:00.000Z",
      max_attempts: 4,
      error_count: 0,
    },
  ]);
  assert.equal(queueBreakdown.social_feed.total, 6);
  assert.equal(queueBreakdown.social_feed.pending, 4);
  assert.equal(queueBreakdown.social_feed.processing, 2);
  assert.equal(queueBreakdown.social_feed.maxAttempts, 4);
  assert.equal(queueBreakdown.social_feed.errorCount, 1);
  console.log("PASS queue breakdown rolls up per-queue status counts");

  const socialFeed = buildSocialFeedOpsSummary(
    {
      ready_jobs: 3,
      processing_jobs: 1,
      failed_jobs: 0,
      oldest_ready_job_at: "2026-04-03T12:00:00.000Z",
    },
    {
      backlog_events: 2,
      failed_events: 1,
      oldest_backlog_event_at: "2026-04-03T12:02:00.000Z",
    },
    {
      posting_posts: 1,
      posted_posts: 12,
      failed_posts: 2,
    }
  );
  assert.equal(socialFeed.jobs.ready, 3);
  assert.equal(socialFeed.ingest.failed, 1);
  assert.equal(socialFeed.posts.posted, 12);

  const socialWarnings = buildOpsWarnings(
    {
      jobs: {},
      ingest: {},
      subscriptions: {},
      socialFeed: {
        ...socialFeed,
        jobs: {
          ...socialFeed.jobs,
          oldestReadyAgeSeconds: 600,
        },
        ingest: {
          ...socialFeed.ingest,
          backlog: 2,
          oldestBacklogAgeSeconds: 700,
        },
      },
    },
    {
      backlogWarningSeconds: 300,
    }
  );
  assert.equal(socialWarnings.some((warning) => warning.code === "social_feed_failed_posts"), true);
  assert.equal(socialWarnings.some((warning) => warning.code === "social_feed_failed_events"), true);
  assert.equal(socialWarnings.some((warning) => warning.code === "social_feed_job_backlog"), true);
  assert.equal(socialWarnings.some((warning) => warning.code === "social_feed_ingest_backlog"), true);
  console.log("PASS social feed ops summary exposes delivery failures");

  const workerWarnings = buildOpsWarnings(
    {
      jobs: {},
      ingest: {},
      subscriptions: {},
      socialFeed: {
        jobs: {},
        ingest: {},
        posts: {},
      },
      workers: {
        running: 1,
        stale: 1,
        latestSeenAgeSeconds: 120,
        maxRssBytes: 700 * 1024 * 1024,
        maxHeapUsedBytes: 300 * 1024 * 1024,
      },
    },
    {
      workerHeartbeatWarningSeconds: 90,
      workerRssWarningBytes: 512 * 1024 * 1024,
      workerHeapWarningBytes: 256 * 1024 * 1024,
    }
  );
  assert.equal(workerWarnings.some((warning) => warning.code === "worker_heartbeat_stale"), true);
  assert.equal(workerWarnings.some((warning) => warning.code === "worker_memory_rss_high"), true);
  assert.equal(workerWarnings.some((warning) => warning.code === "worker_memory_heap_high"), true);
  console.log("PASS worker ops warnings expose stale heartbeats and memory pressure");

  const missingWorkerWarnings = buildOpsWarnings(
    {
      jobs: {},
      ingest: {},
      subscriptions: {},
      socialFeed: {
        jobs: {},
        ingest: {},
        posts: {},
      },
      workers: {
        total: 0,
        running: 0,
        stale: 0,
      },
    },
    {
      workerHeartbeatWarningSeconds: 90,
    }
  );
  assert.equal(missingWorkerWarnings.some((warning) => warning.code === "worker_heartbeat_missing"), true);
  console.log("PASS worker ops warnings flag missing workers");

  const restartStormWarnings = buildOpsWarnings(
    {
      jobs: {},
      ingest: {},
      subscriptions: {},
      socialFeed: { jobs: {}, ingest: {}, posts: {} },
      workers: {
        running: 1,
        stale: 0,
        recentRunningStarts: 4,
      },
    },
    {
      workerRestartStormWindowSeconds: 900,
      workerRestartStormMinCount: 3,
    }
  );
  const restartStormWarning = restartStormWarnings.find((warning) => warning.code === "worker_restart_storm");
  assert.equal(Boolean(restartStormWarning), true);
  assert.match(restartStormWarning.message, /start event/);
  console.log("PASS ops warnings flag repeated starts of one worker as a restart storm");

  const pagerFailWarnings = buildOpsWarnings(
    {
      jobs: {},
      ingest: {},
      subscriptions: {},
      socialFeed: { jobs: {}, ingest: {}, posts: {} },
      workers: { total: 1, running: 1, stale: 0 },
      pager: { failedDeliveriesInWindow: 5 },
    },
    {
      pagerDeliveryFailWindowSeconds: 3600,
      pagerDeliveryFailMinCount: 3,
    }
  );
  assert.equal(pagerFailWarnings.some((warning) => warning.code === "pager_webhook_delivery_failures"), true);
  console.log("PASS ops warnings flag repeated pager webhook delivery failures");

  resetRuntimeState();
}

main().catch((error) => {
  console.error("FAIL ops runtime coverage");
  console.error(error?.stack || error);
  process.exit(1);
});
