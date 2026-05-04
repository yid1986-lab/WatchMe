const MAX_RECENT_FAILURES = 20;

const state = {
  workerName: null,
  nodeEnv: null,
  queues: [],
  pollIntervalMs: null,
  batchSize: null,
  concurrency: null,
  lockTimeoutSeconds: null,
  startedAt: null,
  tickInProgress: false,
  lastTickStartedAt: null,
  lastTickFinishedAt: null,
  lastTickDurationMs: null,
  totalTicks: 0,
  totalJobsClaimed: 0,
  totalJobsCompleted: 0,
  totalJobsFailed: 0,
  totalStaleLocksReleased: 0,
  lastSubscriptionSweepAt: null,
  lastSubscriptionSweepCount: 0,
  lastError: null,
  recentFailures: [],
  process: {
    pid: null,
    sampledAt: null,
    uptimeSeconds: 0,
    rssBytes: 0,
    heapUsedBytes: 0,
    heapTotalBytes: 0,
    externalBytes: 0,
    arrayBuffersBytes: 0,
    maxRssBytes: 0,
    maxHeapUsedBytes: 0,
    sampleCount: 0,
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function noteRunnerStart(config = {}) {
  state.workerName = config.workerName || state.workerName;
  state.nodeEnv = config.nodeEnv || state.nodeEnv;
  state.queues = Array.isArray(config.queues) ? [...config.queues] : [];
  state.pollIntervalMs = Number(config.pollIntervalMs || 0);
  state.batchSize = Number(config.batchSize || 0);
  state.concurrency = Number(config.concurrency || 0);
  state.lockTimeoutSeconds = Number(config.lockTimeoutSeconds || 0);
  if (!state.startedAt) {
    state.startedAt = new Date().toISOString();
  }
  noteProcessSample();
}

function noteTickStart() {
  state.tickInProgress = true;
  state.lastTickStartedAt = new Date().toISOString();
}

function noteTickEnd(error = null) {
  const finishedAt = new Date();
  state.tickInProgress = false;
  state.lastTickFinishedAt = finishedAt.toISOString();
  state.totalTicks += 1;

  if (state.lastTickStartedAt) {
    state.lastTickDurationMs = Math.max(0, finishedAt.getTime() - new Date(state.lastTickStartedAt).getTime());
  }

  if (error) {
    state.lastError = String(error?.message || error);
  }

  noteProcessSample();
}

function noteJobsClaimed(count) {
  state.totalJobsClaimed += Math.max(0, Number(count || 0));
}

function noteJobCompleted() {
  state.totalJobsCompleted += 1;
}

function noteJobFailed(job = {}, error) {
  state.totalJobsFailed += 1;
  state.lastError = String(error?.message || error || "Unknown worker error");
  state.recentFailures.unshift({
    jobId: job.job_id || null,
    queueName: job.queue_name || null,
    jobType: job.job_type || null,
    attempts: Number(job.attempts || 0),
    error: state.lastError,
    seenAt: new Date().toISOString(),
  });
  state.recentFailures = state.recentFailures.slice(0, MAX_RECENT_FAILURES);
}

function noteStaleLocksReleased(count) {
  state.totalStaleLocksReleased += Math.max(0, Number(count || 0));
}

function noteSubscriptionSweep(count) {
  state.lastSubscriptionSweepAt = new Date().toISOString();
  state.lastSubscriptionSweepCount = Math.max(0, Number(count || 0));
}

function buildProcessSample() {
  const memory = process.memoryUsage();

  return {
    pid: process.pid,
    sampledAt: new Date().toISOString(),
    uptimeSeconds: Number(process.uptime().toFixed(1)),
    rssBytes: Number(memory.rss || 0),
    heapUsedBytes: Number(memory.heapUsed || 0),
    heapTotalBytes: Number(memory.heapTotal || 0),
    externalBytes: Number(memory.external || 0),
    arrayBuffersBytes: Number(memory.arrayBuffers || 0),
  };
}

function noteProcessSample() {
  const sample = buildProcessSample();
  state.process = {
    ...state.process,
    ...sample,
    maxRssBytes: Math.max(Number(state.process.maxRssBytes || 0), Number(sample.rssBytes || 0)),
    maxHeapUsedBytes: Math.max(Number(state.process.maxHeapUsedBytes || 0), Number(sample.heapUsedBytes || 0)),
    sampleCount: Number(state.process.sampleCount || 0) + 1,
  };
}

function getRuntimeSnapshot() {
  noteProcessSample();
  return clone(state);
}

function resetRuntimeState() {
  state.workerName = null;
  state.nodeEnv = null;
  state.queues = [];
  state.pollIntervalMs = null;
  state.batchSize = null;
  state.concurrency = null;
  state.lockTimeoutSeconds = null;
  state.startedAt = null;
  state.tickInProgress = false;
  state.lastTickStartedAt = null;
  state.lastTickFinishedAt = null;
  state.lastTickDurationMs = null;
  state.totalTicks = 0;
  state.totalJobsClaimed = 0;
  state.totalJobsCompleted = 0;
  state.totalJobsFailed = 0;
  state.totalStaleLocksReleased = 0;
  state.lastSubscriptionSweepAt = null;
  state.lastSubscriptionSweepCount = 0;
  state.lastError = null;
  state.recentFailures = [];
  state.process = {
    pid: null,
    sampledAt: null,
    uptimeSeconds: 0,
    rssBytes: 0,
    heapUsedBytes: 0,
    heapTotalBytes: 0,
    externalBytes: 0,
    arrayBuffersBytes: 0,
    maxRssBytes: 0,
    maxHeapUsedBytes: 0,
    sampleCount: 0,
  };
}

module.exports = {
  getRuntimeSnapshot,
  noteJobCompleted,
  noteJobFailed,
  noteJobsClaimed,
  noteProcessSample,
  noteRunnerStart,
  noteStaleLocksReleased,
  noteSubscriptionSweep,
  noteTickEnd,
  noteTickStart,
  resetRuntimeState,
};
