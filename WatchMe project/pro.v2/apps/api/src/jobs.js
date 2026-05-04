const {
  buildEventDedupeKey,
  buildJobPayload,
  buildLiveSessionKey,
  isSocialEventType,
  JOB_TYPES,
  QUEUES,
} = require("../../../packages/shared/src");
const { query } = require("./db");

async function enqueueJob({
  queueName,
  jobType,
  payload,
  priority = 100,
  dedupeKey = null,
  availableAt = null,
  maxAttempts = 10,
  reopenOnConflict = false,
}) {
  const result = await query(
    `
      INSERT INTO job_queue (
        queue_name,
        job_type,
        status,
        priority,
        dedupe_key,
        payload_json,
        available_at,
        max_attempts,
        updated_at
      )
      VALUES (
        $1, $2, 'pending', $3, $4, $5::jsonb,
        COALESCE($6::timestamptz, NOW()),
        $7,
        NOW()
      )
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL
      DO UPDATE SET
        queue_name = EXCLUDED.queue_name,
        job_type = EXCLUDED.job_type,
        payload_json = EXCLUDED.payload_json,
        available_at = CASE
          WHEN $8 AND job_queue.status IN ('completed', 'failed') THEN EXCLUDED.available_at
          WHEN job_queue.status IN ('completed', 'failed') THEN job_queue.available_at
          ELSE LEAST(job_queue.available_at, EXCLUDED.available_at)
        END,
        status = CASE
          WHEN $8 AND job_queue.status IN ('completed', 'failed') THEN 'pending'
          ELSE job_queue.status
        END,
        locked_at = CASE
          WHEN $8 AND job_queue.status IN ('completed', 'failed') THEN NULL
          ELSE job_queue.locked_at
        END,
        locked_by = CASE
          WHEN $8 AND job_queue.status IN ('completed', 'failed') THEN NULL
          ELSE job_queue.locked_by
        END,
        attempts = CASE
          WHEN $8 AND job_queue.status IN ('completed', 'failed') THEN 0
          ELSE job_queue.attempts
        END,
        max_attempts = EXCLUDED.max_attempts,
        last_error = CASE
          WHEN $8 AND job_queue.status IN ('completed', 'failed') THEN NULL
          ELSE job_queue.last_error
        END,
        priority = CASE
          WHEN $8 AND job_queue.status IN ('completed', 'failed') THEN EXCLUDED.priority
          ELSE LEAST(job_queue.priority, EXCLUDED.priority)
        END,
        updated_at = NOW()
      RETURNING *
    `,
    [
      queueName,
      jobType,
      priority,
      dedupeKey,
      JSON.stringify(buildJobPayload(payload)),
      availableAt,
      maxAttempts,
      reopenOnConflict,
    ]
  );

  return result.rows[0];
}

async function enqueuePlatformSubscriptionRenewal(platform, topicKey, payload = {}) {
  const dedupeKey = payload.subscriptionId
    ? `renew-subscription:${payload.subscriptionId}`
    : `renew:${platform}:${topicKey}`;

  return enqueueJob({
    queueName: QUEUES.PLATFORM_SUBSCRIPTION,
    jobType: JOB_TYPES.RENEW_PLATFORM_SUBSCRIPTION,
    dedupeKey,
    payload: {
      platform,
      topicKey,
      ...payload,
    },
    priority: 40,
    reopenOnConflict: true,
  });
}

async function enqueuePlatformEventIngest(event = {}) {
  const dedupeKey = event.dedupeKey || buildEventDedupeKey(event);
  const sessionKey = event.sessionKey || (
    isSocialEventType(event.eventType)
      ? `social:${String(event.platform || "").trim().toLowerCase()}:${String(event.sourceExternalId || dedupeKey || "unknown").trim().toLowerCase()}`
      : buildLiveSessionKey(event)
  );

  return enqueueJob({
    queueName: QUEUES.PLATFORM_INGEST,
    jobType: JOB_TYPES.INGEST_PLATFORM_EVENT,
    dedupeKey: `event-ingest:${dedupeKey}`,
    payload: {
      eventId: event.eventId,
      platform: event.platform,
      eventType: event.eventType,
      sourceKey: event.sourceKey,
      sourceExternalId: event.sourceExternalId || null,
      sourceCreatedAt: event.sourceCreatedAt || null,
      sessionKey,
      dedupeKey,
    },
    priority: 10,
  });
}

async function enqueueLivePost(guildId, platform, sessionKey, payload = {}) {
  return enqueueJob({
    queueName: QUEUES.LIVE_POST,
    jobType: JOB_TYPES.DISPATCH_LIVE_POST,
    dedupeKey: `live:${guildId}:${platform}:${sessionKey}`,
    payload: {
      guildId,
      platform,
      sessionKey,
      ...payload,
    },
    priority: 20,
  });
}

async function enqueueSocialPostDispatch(discordUserId, dispatchId, payload = {}, availableAt = null) {
  return enqueueJob({
    queueName: QUEUES.SOCIAL_POST,
    jobType: JOB_TYPES.DISPATCH_SOCIAL_POST,
    dedupeKey: `social-dispatch:${dispatchId}`,
    payload: {
      discordUserId,
      dispatchId,
      ...payload,
    },
    priority: 30,
    availableAt,
  });
}

async function enqueueMobilePush(activityId, discordUserId, payload = {}) {
  return enqueueJob({
    queueName: QUEUES.MAINTENANCE,
    jobType: JOB_TYPES.DISPATCH_MOBILE_PUSH,
    dedupeKey: `mobile-push:${activityId}`,
    payload: {
      activityId,
      discordUserId,
      ...payload,
    },
    priority: 35,
    maxAttempts: 5,
  });
}

module.exports = {
  enqueueJob,
  enqueueMobilePush,
  enqueuePlatformEventIngest,
  enqueueLivePost,
  enqueueSocialPostDispatch,
  enqueuePlatformSubscriptionRenewal,
};
