const {
  buildEventDedupeKey,
  buildJobPayload,
  buildSocialOriginKey,
  isSocialEventType,
  JOB_TYPES,
  QUEUES,
} = require("../../../packages/shared/src");
const { query, withTransaction } = require("./db");
let workerHeartbeatSchemaEnsured = false;
let liveAutomationSchemaEnsured = false;

async function ensureWorkerHeartbeatSchema() {
  if (workerHeartbeatSchemaEnsured) {
    return;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS worker_heartbeats (
      worker_name TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'running',
      node_env TEXT,
      queues_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      process_id INTEGER,
      started_at TIMESTAMPTZ,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_tick_started_at TIMESTAMPTZ,
      last_tick_finished_at TIMESTAMPTZ,
      tick_in_progress BOOLEAN NOT NULL DEFAULT FALSE,
      total_ticks BIGINT NOT NULL DEFAULT 0,
      total_jobs_claimed BIGINT NOT NULL DEFAULT 0,
      total_jobs_completed BIGINT NOT NULL DEFAULT 0,
      total_jobs_failed BIGINT NOT NULL DEFAULT 0,
      total_stale_locks_released BIGINT NOT NULL DEFAULT 0,
      last_subscription_sweep_at TIMESTAMPTZ,
      last_subscription_sweep_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      uptime_seconds DOUBLE PRECISION,
      rss_bytes BIGINT,
      heap_used_bytes BIGINT,
      heap_total_bytes BIGINT,
      external_bytes BIGINT,
      array_buffers_bytes BIGINT,
      max_rss_bytes BIGINT,
      max_heap_used_bytes BIGINT,
      sample_count BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS worker_heartbeats_status_seen_idx
      ON worker_heartbeats (status, last_seen_at, updated_at);

    CREATE TABLE IF NOT EXISTS worker_start_events (
      worker_name TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (worker_name, started_at)
    );

    CREATE INDEX IF NOT EXISTS worker_start_events_started_idx
      ON worker_start_events (started_at DESC, worker_name);
  `);

  workerHeartbeatSchemaEnsured = true;
}

async function ensureLiveAutomationSchema() {
  if (liveAutomationSchemaEnsured) {
    return;
  }

  await query(`
    ALTER TABLE guild_config
      ADD COLUMN IF NOT EXISTS live_filter_games_json JSONB NOT NULL DEFAULT '[]'::jsonb;

    ALTER TABLE guild_config
      ADD COLUMN IF NOT EXISTS live_filter_languages_json JSONB NOT NULL DEFAULT '[]'::jsonb;

    ALTER TABLE guild_config
      ADD COLUMN IF NOT EXISTS live_filter_min_viewers INTEGER;

    ALTER TABLE guild_config
      ADD COLUMN IF NOT EXISTS live_filter_max_viewers INTEGER;

    ALTER TABLE guild_config
      ADD COLUMN IF NOT EXISTS category_role_routes_json JSONB NOT NULL DEFAULT '[]'::jsonb;

    ALTER TABLE guild_config
      ADD COLUMN IF NOT EXISTS auto_start_thread BOOLEAN NOT NULL DEFAULT FALSE;

    ALTER TABLE guild_config
      ADD COLUMN IF NOT EXISTS auto_start_thread_name TEXT;

    ALTER TABLE guild_config
      ADD COLUMN IF NOT EXISTS stream_end_message_enabled BOOLEAN NOT NULL DEFAULT FALSE;

    ALTER TABLE guild_config
      ADD COLUMN IF NOT EXISTS stream_end_message_template TEXT;

    CREATE TABLE IF NOT EXISTS creator_live_alerts (
      creator_live_alert_id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL REFERENCES guilds(guild_id),
      discord_user_id TEXT NOT NULL REFERENCES users(discord_user_id),
      platform TEXT NOT NULL,
      session_key TEXT NOT NULL,
      source_external_id TEXT,
      discord_message_id TEXT,
      title TEXT,
      category_name TEXT,
      viewer_count INTEGER,
      started_at TIMESTAMPTZ,
      posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (guild_id, discord_user_id, platform, session_key)
    );

    CREATE INDEX IF NOT EXISTS creator_live_alerts_guild_posted_idx
      ON creator_live_alerts (guild_id, posted_at DESC);

    CREATE INDEX IF NOT EXISTS creator_live_alerts_creator_posted_idx
      ON creator_live_alerts (guild_id, discord_user_id, posted_at DESC);

    ALTER TABLE creator_post_dispatches
      ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

    ALTER TABLE creator_post_dispatches
      ADD COLUMN IF NOT EXISTS source_type TEXT;

    ALTER TABLE creator_post_dispatches
      ADD COLUMN IF NOT EXISTS source_key TEXT;

    CREATE UNIQUE INDEX IF NOT EXISTS creator_post_dispatches_source_idx
      ON creator_post_dispatches (discord_user_id, source_type, source_key)
      WHERE source_type IS NOT NULL AND source_key IS NOT NULL;

    CREATE TABLE IF NOT EXISTS automation_activity_events (
      activity_id BIGSERIAL PRIMARY KEY,
      discord_user_id TEXT NOT NULL REFERENCES users(discord_user_id),
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      severity TEXT NOT NULL DEFAULT 'info',
      platform TEXT,
      dispatch_id BIGINT,
      publication_id BIGINT,
      source_type TEXT,
      source_key TEXT,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      push_status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS automation_activity_user_created_idx
      ON automation_activity_events (discord_user_id, created_at DESC, activity_id DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS automation_activity_source_idx
      ON automation_activity_events (discord_user_id, source_type, source_key)
      WHERE source_type IS NOT NULL AND source_key IS NOT NULL;

    CREATE TABLE IF NOT EXISTS mobile_push_devices (
      device_id BIGSERIAL PRIMARY KEY,
      discord_user_id TEXT NOT NULL REFERENCES users(discord_user_id),
      push_token TEXT NOT NULL UNIQUE,
      device_platform TEXT NOT NULL DEFAULT 'android',
      app_version TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS mobile_push_devices_user_status_idx
      ON mobile_push_devices (discord_user_id, status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS mobile_push_deliveries (
      delivery_id BIGSERIAL PRIMARY KEY,
      activity_id BIGINT REFERENCES automation_activity_events(activity_id),
      device_id BIGINT REFERENCES mobile_push_devices(device_id),
      discord_user_id TEXT NOT NULL REFERENCES users(discord_user_id),
      status TEXT NOT NULL,
      error_text TEXT,
      response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS mobile_push_deliveries_activity_idx
      ON mobile_push_deliveries (activity_id, status, updated_at DESC);
  `);

  liveAutomationSchemaEnsured = true;
}

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
        $1,
        $2,
        'pending',
        $3,
        $4,
        $5::jsonb,
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

  return result.rows[0] || null;
}

async function enqueuePlatformEventJob(event = {}) {
  return enqueueJob({
    queueName: QUEUES.PLATFORM_INGEST,
    jobType: JOB_TYPES.INGEST_PLATFORM_EVENT,
    dedupeKey: `event-ingest:${event.eventId}`,
    payload: {
      eventId: event.eventId,
      platform: event.platform,
      eventType: event.eventType,
      sourceKey: event.sourceKey,
      sourceExternalId: event.sourceExternalId || null,
      sourceCreatedAt: event.sourceCreatedAt || null,
      sessionKey: event.sessionKey || (
        isSocialEventType(event.eventType)
          ? `social:${String(event.platform || "").trim().toLowerCase()}:${String(event.sourceExternalId || event.eventId || "unknown").trim().toLowerCase()}`
          : null
      ),
    },
    priority: 10,
  });
}

async function enqueueProcessLiveEvent(event = {}) {
  return enqueueJob({
    queueName: QUEUES.PLATFORM_INGEST,
    jobType: JOB_TYPES.PROCESS_LIVE_EVENT,
    dedupeKey: `process-live:${event.eventId}`,
    payload: {
      eventId: event.eventId,
      platform: event.platform,
      eventType: event.eventType,
      sourceKey: event.sourceKey,
      sourceExternalId: event.sourceExternalId || null,
      sourceCreatedAt: event.sourceCreatedAt || null,
      sessionKey: event.sessionKey,
      payload: event.payload || {},
    },
    priority: 15,
  });
}

async function enqueueProcessSocialEvent(event = {}) {
  return enqueueJob({
    queueName: QUEUES.SOCIAL_FEED,
    jobType: JOB_TYPES.PROCESS_SOCIAL_EVENT,
    dedupeKey: `process-social:${event.eventId}`,
    payload: {
      eventId: event.eventId,
      platform: event.platform,
      eventType: event.eventType,
      sourceKey: event.sourceKey,
      sourceExternalId: event.sourceExternalId || null,
      sourceCreatedAt: event.sourceCreatedAt || null,
      sessionKey: event.sessionKey,
      payload: event.payload || {},
    },
    priority: 18,
  });
}

async function enqueueLivePostJob(target = {}, event = {}) {
  const productScope = normalizeProductScope(target.productScope || target.scope);
  const sessionKey = buildScopedLiveSessionKey(event.sessionKey, productScope);
  return enqueueJob({
    queueName: QUEUES.LIVE_POST,
    jobType: JOB_TYPES.DISPATCH_LIVE_POST,
    dedupeKey: buildLivePostDedupeKey({
      productScope,
      guildId: target.guildId,
      platform: event.platform,
      sessionKey,
    }),
    payload: {
      guildId: target.guildId,
      productScope,
      channelId: target.channelId,
      liveRoleId: target.liveRoleId,
      mentionMode: target.mentionMode,
      brandName: target.brandName,
      brandLogoUrl: target.brandLogoUrl || null,
      previewImageUrl: target.previewImageUrl || null,
      creatorAvatarUrl: target.creatorAvatarUrl || null,
      guildIconUrl: target.guildIconUrl || null,
      footerText: target.footerText || null,
      autoCleanup: Boolean(target.autoCleanup),
      cooldownSeconds: target.cooldownSeconds,
      autoStartThread: Boolean(target.autoStartThread),
      autoStartThreadName: target.autoStartThreadName || null,
      streamEndMessageEnabled: Boolean(target.streamEndMessageEnabled),
      streamEndMessageTemplate: target.streamEndMessageTemplate || null,
      creatorDiscordUserId: target.creatorDiscordUserId || null,
      creatorDisplayName: target.creatorDisplayName || null,
      entitlementStatus: target.entitlementStatus,
      deliveryMode: target.deliveryMode,
      eventId: event.eventId,
      platform: event.platform,
      eventType: event.eventType,
      sourceKey: event.sourceKey,
      sourceExternalId: event.sourceExternalId || null,
      sourceCreatedAt: event.sourceCreatedAt || null,
      sourceSessionKey: event.sessionKey,
      sessionKey,
      payload: event.payload || {},
    },
    priority: 20,
  });
}

function normalizeProductScope(scope) {
  const normalized = String(scope || "").trim().toLowerCase();
  if (normalized === "lite") {
    return "lite";
  }
  if (normalized === "creator") {
    return "creator";
  }
  return "guild";
}

function buildScopedLiveSessionKey(sessionKey, productScope) {
  const base = String(sessionKey || "").trim() || "live:unknown";
  return normalizeProductScope(productScope) === "lite" && !base.startsWith("lite:")
    ? `lite:${base}`
    : base;
}

function buildLivePostDedupeKey({ productScope, guildId, platform, sessionKey } = {}) {
  return `live:${normalizeProductScope(productScope)}:${guildId}:${platform}:${sessionKey}`;
}

async function enqueueSocialFeedPostJob(target = {}, event = {}) {
  return enqueueJob({
    queueName: QUEUES.SOCIAL_FEED,
    jobType: JOB_TYPES.DISPATCH_SOCIAL_FEED_POST,
    dedupeKey: `social-feed:${target.guildId}:${event.platform}:${event.sessionKey}`,
    payload: {
      guildId: target.guildId,
      channelId: target.channelId,
      brandName: target.brandName,
      brandLogoUrl: target.brandLogoUrl || null,
      previewImageUrl: target.previewImageUrl || null,
      footerText: target.footerText || null,
      creatorDiscordUserId: target.creatorDiscordUserId || null,
      creatorDisplayName: target.creatorDisplayName || null,
      entitlementStatus: target.entitlementStatus,
      deliveryMode: target.deliveryMode,
      eventId: event.eventId,
      platform: event.platform,
      eventType: event.eventType,
      sourceKey: event.sourceKey,
      sourceExternalId: event.sourceExternalId || null,
      sourceCreatedAt: event.sourceCreatedAt || null,
      sessionKey: event.sessionKey,
      payload: event.payload || {},
    },
    priority: 22,
  });
}

async function enqueueSocialPostDispatchJob(discordUserId, dispatchId, payload = {}, availableAt = null) {
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

async function enqueueMobilePushJob(activityId, discordUserId, payload = {}) {
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

async function enqueuePlatformSubscriptionRenewalJob(payload = {}, availableAt = null) {
  const dedupeKey =
    payload.subscriptionId
      ? `renew-subscription:${payload.subscriptionId}`
      : `renew:${payload.platform}:${payload.topicKey}`;

  return enqueueJob({
    queueName: QUEUES.PLATFORM_SUBSCRIPTION,
    jobType: JOB_TYPES.RENEW_PLATFORM_SUBSCRIPTION,
    dedupeKey,
    payload,
    availableAt,
    priority: 40,
    reopenOnConflict: true,
  });
}

async function ingestPlatformEvent(event = {}) {
  const dedupeKey = event.dedupeKey || buildEventDedupeKey({
    platform: event.platform,
    eventType: event.eventType,
    sourceKey: event.sourceKey,
    sourceExternalId: event.sourceExternalId,
    sourceCreatedAt: event.sourceCreatedAt,
    providerEventId: event.providerEventId,
  });

  const result = await query(
    `
      INSERT INTO event_ingest (
        platform,
        event_type,
        source_key,
        source_external_id,
        source_created_at,
        payload_json,
        dedupe_key,
        processing_state
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'received')
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL
      DO UPDATE SET
        payload_json = EXCLUDED.payload_json,
        source_created_at = COALESCE(EXCLUDED.source_created_at, event_ingest.source_created_at)
      RETURNING *
    `,
    [
      event.platform,
      event.eventType,
      event.sourceKey,
      event.sourceExternalId || null,
      event.sourceCreatedAt || null,
      JSON.stringify(event.payload || {}),
      dedupeKey,
    ]
  );

  return result.rows[0] || null;
}

async function getEventById(eventId) {
  const result = await query(
    `
      SELECT *
      FROM event_ingest
      WHERE event_id = $1
    `,
    [eventId]
  );

  return result.rows[0] || null;
}

async function updateEventState(eventId, nextState) {
  const result = await query(
    `
      UPDATE event_ingest
      SET processing_state = $2
      WHERE event_id = $1
      RETURNING *
    `,
    [eventId, nextState]
  );

  return result.rows[0] || null;
}

async function getPlatformSubscriptionById(subscriptionId) {
  const result = await query(
    `
      SELECT *
      FROM platform_subscriptions
      WHERE subscription_id = $1
    `,
    [subscriptionId]
  );

  return result.rows[0] || null;
}

async function getPlatformSubscriptionsDueForRenewal(leadSeconds = 1800, limit = 100) {
  const result = await query(
    `
      SELECT *
      FROM platform_subscriptions
      WHERE status IN ('pending', 'revoked')
         OR (
           status = 'active'
           AND (
             lease_expires_at IS NULL
             OR lease_expires_at < NOW() + make_interval(secs => $1)
           )
         )
      ORDER BY
        CASE
          WHEN status = 'revoked' THEN 0
          WHEN status = 'pending' THEN 1
          WHEN lease_expires_at IS NULL THEN 2
          ELSE 3
        END,
        lease_expires_at NULLS FIRST,
        subscription_id ASC
      LIMIT $2
    `,
    [leadSeconds, limit]
  );

  return result.rows;
}

function normalizeMatchList(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [values])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

async function findPlatformSubscriptionsForSync({ platform, topicKeys = [], sourceUrls = [] } = {}) {
  const topicMatches = normalizeMatchList(topicKeys);
  const sourceUrlMatches = normalizeMatchList(sourceUrls);

  if (!platform || (!topicMatches.length && !sourceUrlMatches.length)) {
    return [];
  }

  const params = [platform];
  const matchClauses = [];

  if (topicMatches.length) {
    params.push(topicMatches);
    matchClauses.push(`topic_key = ANY($${params.length}::text[])`);
  }

  if (sourceUrlMatches.length) {
    params.push(sourceUrlMatches);
    matchClauses.push(`COALESCE(metadata_json->>'sourceUrl', '') = ANY($${params.length}::text[])`);
  }

  const result = await query(
    `
      SELECT *
      FROM platform_subscriptions
      WHERE platform = $1
        AND status <> 'disabled'
        AND (${matchClauses.join(" OR ")})
      ORDER BY subscription_id ASC
    `,
    params
  );

  return result.rows;
}

async function syncPlatformSubscriptionsToCanonicalTopic({
  platform,
  canonicalTopicKey,
  topicKeys = [],
  sourceUrls = [],
  patch = {},
} = {}) {
  const rows = await findPlatformSubscriptionsForSync({
    platform,
    topicKeys: [canonicalTopicKey, ...topicKeys],
    sourceUrls,
  });

  const updatedRows = [];
  for (const row of rows) {
    const updated = await updatePlatformSubscriptionById(row.subscription_id, {
      ...patch,
      topicKey: canonicalTopicKey,
      metadataJson: {
        canonicalTopicKey,
        ...(patch.metadataJson || {}),
      },
    });

    if (updated) {
      updatedRows.push(updated);
    }
  }

  return updatedRows;
}

async function updatePlatformSubscriptionById(subscriptionId, patch = {}) {
  const result = await query(
    `
      WITH current_row AS (
        SELECT *
        FROM platform_subscriptions
        WHERE subscription_id = $1
      ),
      deleted_duplicates AS (
        DELETE FROM platform_subscriptions duplicate_row
        USING current_row
        WHERE duplicate_row.subscription_id <> current_row.subscription_id
          AND duplicate_row.platform = current_row.platform
          AND duplicate_row.topic_key = COALESCE($2, current_row.topic_key)
          AND duplicate_row.guild_id IS NOT DISTINCT FROM current_row.guild_id
          AND duplicate_row.creator_guild_id IS NOT DISTINCT FROM current_row.creator_guild_id
          AND duplicate_row.creator_discord_user_id IS NOT DISTINCT FROM current_row.creator_discord_user_id
      )
      UPDATE platform_subscriptions
      SET
        topic_key = COALESCE($2, topic_key),
        provider_subscription_id = COALESCE($3, provider_subscription_id),
        callback_url = COALESCE($4, callback_url),
        status = COALESCE($5, status),
        lease_expires_at = COALESCE($6::timestamptz, lease_expires_at),
        last_verified_at = COALESCE($7::timestamptz, last_verified_at),
        metadata_json = metadata_json || $8::jsonb,
        updated_at = NOW()
      WHERE subscription_id = $1
      RETURNING *
    `,
    [
      subscriptionId,
      patch.topicKey || null,
      patch.providerSubscriptionId || null,
      patch.callbackUrl || null,
      patch.status || null,
      patch.leaseExpiresAt || null,
      patch.lastVerifiedAt || null,
      JSON.stringify(patch.metadataJson || {}),
    ]
  );

  return result.rows[0] || null;
}

async function updatePlatformSubscriptionsByTopic(platform, topicKey, patch = {}) {
  const result = await query(
    `
      UPDATE platform_subscriptions
      SET
        status = COALESCE($3, status),
        callback_url = COALESCE($4, callback_url),
        lease_expires_at = COALESCE($5::timestamptz, lease_expires_at),
        last_verified_at = COALESCE($6::timestamptz, last_verified_at),
        metadata_json = metadata_json || $7::jsonb,
        updated_at = NOW()
      WHERE platform = $1
        AND topic_key = $2
      RETURNING *
    `,
    [
      platform,
      topicKey,
      patch.status || null,
      patch.callbackUrl || null,
      patch.leaseExpiresAt || null,
      patch.lastVerifiedAt || null,
      JSON.stringify(patch.metadataJson || {}),
    ]
  );

  return result.rows;
}

async function touchPlatformSubscription(payload = {}) {
  const subscriptionScope = normalizeProductScope(payload.scope || payload.metadata?.scope);
  const metadataJson = {
    ...(payload.metadata || {}),
    scope: subscriptionScope,
    lastRenewedBy: payload.workerName || null,
    lastRenewedAt: new Date().toISOString(),
  };

  const guildId = subscriptionScope === "guild" || subscriptionScope === "lite" ? payload.guildId || null : null;
  const creatorGuildId = subscriptionScope === "creator" ? payload.guildId || null : null;
  const creatorDiscordUserId = subscriptionScope === "creator" ? payload.discordUserId || null : null;

  const result = await query(
    `
      INSERT INTO platform_subscriptions (
        guild_id,
        creator_guild_id,
        creator_discord_user_id,
        platform,
        topic_key,
        callback_url,
        status,
        lease_expires_at,
        last_verified_at,
        metadata_json,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        'active',
        NOW() + INTERVAL '6 hours',
        NOW(),
        $7::jsonb,
        NOW()
      )
      ON CONFLICT (
        platform,
        topic_key,
        guild_id,
        creator_guild_id,
        creator_discord_user_id
      ) DO UPDATE SET
        callback_url = COALESCE(EXCLUDED.callback_url, platform_subscriptions.callback_url),
        status = 'active',
        lease_expires_at = NOW() + INTERVAL '6 hours',
        last_verified_at = NOW(),
        metadata_json = platform_subscriptions.metadata_json || EXCLUDED.metadata_json,
        updated_at = NOW()
      RETURNING *
    `,
    [
      guildId,
      creatorGuildId,
      creatorDiscordUserId,
      payload.platform,
      payload.topicKey,
      payload.callbackUrl || null,
      JSON.stringify(metadataJson),
    ]
  );

  return result.rows[0] || null;
}

async function getLiveEventTargets(platform, sourceKey) {
  await ensureLiveAutomationSchema();

  const result = await query(
    `
      SELECT
        ps.subscription_id,
        COALESCE(NULLIF(ps.metadata_json->>'scope', ''), CASE WHEN ps.creator_discord_user_id IS NULL THEN 'guild' ELSE 'creator' END) AS product_scope,
        ps.metadata_json->>'displayName' AS creator_display_name,
        COALESCE(ps.guild_id, ps.creator_guild_id) AS guild_id,
        ps.creator_discord_user_id,
        COALESCE(gc.live_channel_id, gc.announce_channel_id) AS channel_id,
        gc.live_role_id,
        gc.mention_mode,
        gc.brand_name,
        gc.brand_logo_url,
        gc.preview_image_url,
        u.avatar_url AS creator_avatar_url,
        g.icon_url AS guild_icon_url,
        gc.footer_text,
        gc.auto_cleanup,
        gc.cooldown_seconds,
        gc.live_filter_games_json,
        gc.live_filter_languages_json,
        gc.live_filter_min_viewers,
        gc.live_filter_max_viewers,
        gc.category_role_routes_json,
        gc.auto_start_thread,
        gc.auto_start_thread_name,
        gc.stream_end_message_enabled,
        gc.stream_end_message_template,
        COALESCE(pe.status, 'inactive') AS entitlement_status
      FROM platform_subscriptions ps
      LEFT JOIN guild_config gc
        ON gc.guild_id = COALESCE(ps.guild_id, ps.creator_guild_id)
      LEFT JOIN pro_entitlements pe
        ON pe.bound_guild_id = COALESCE(ps.guild_id, ps.creator_guild_id)
      LEFT JOIN users u
        ON u.discord_user_id = ps.creator_discord_user_id
      LEFT JOIN guilds g
        ON g.guild_id = COALESCE(ps.guild_id, ps.creator_guild_id)
      LEFT JOIN creator_access ca
        ON ca.guild_id = ps.creator_guild_id
       AND ca.discord_user_id = ps.creator_discord_user_id
      WHERE ps.platform = $1
        AND ps.topic_key = $2
        AND ps.status = 'active'
        AND COALESCE(gc.live_channel_id, gc.announce_channel_id) IS NOT NULL
        AND (
          ps.creator_discord_user_id IS NULL
          OR ca.status = 'approved'
        )
      ORDER BY COALESCE(ps.guild_id, ps.creator_guild_id), ps.subscription_id
    `,
    [platform, sourceKey]
  );

  return result.rows.map((row) => ({
    subscriptionId: row.subscription_id,
    productScope: normalizeProductScope(row.product_scope),
    guildId: row.guild_id,
    creatorDiscordUserId: row.creator_discord_user_id,
    creatorDisplayName: row.creator_display_name,
    channelId: row.channel_id,
    liveRoleId: row.live_role_id,
    mentionMode: row.mention_mode,
    brandName: row.brand_name,
    brandLogoUrl: row.brand_logo_url,
    previewImageUrl: row.preview_image_url,
    creatorAvatarUrl: row.creator_avatar_url,
    guildIconUrl: row.guild_icon_url,
    footerText: row.footer_text,
    autoCleanup: Boolean(row.auto_cleanup),
    cooldownSeconds: row.cooldown_seconds,
    liveFilterGames: Array.isArray(row.live_filter_games_json) ? row.live_filter_games_json : [],
    liveFilterLanguages: Array.isArray(row.live_filter_languages_json) ? row.live_filter_languages_json : [],
    liveFilterMinViewers: row.live_filter_min_viewers ?? null,
    liveFilterMaxViewers: row.live_filter_max_viewers ?? null,
    categoryRoleRoutes: Array.isArray(row.category_role_routes_json) ? row.category_role_routes_json : [],
    autoStartThread: Boolean(row.auto_start_thread),
    autoStartThreadName: row.auto_start_thread_name || null,
    streamEndMessageEnabled: Boolean(row.stream_end_message_enabled),
    streamEndMessageTemplate: row.stream_end_message_template || null,
    entitlementStatus: row.entitlement_status,
  }));
}

async function getSocialEventTargets(platform, externalAccountId) {
  const result = await query(
    `
      SELECT
        ca.guild_id,
        ca.discord_user_id AS creator_discord_user_id,
        gc.socials_feed_channel_id AS channel_id,
        gc.brand_name,
        gc.brand_logo_url,
        gc.preview_image_url,
        gc.footer_text,
        COALESCE(cp.display_name, csc.external_account_name, csc.external_account_id) AS creator_display_name,
        COALESCE(pe.status, 'inactive') AS entitlement_status
      FROM creator_social_connections csc
      INNER JOIN creator_access ca
        ON ca.discord_user_id = csc.discord_user_id
       AND ca.status = 'approved'
      INNER JOIN guild_config gc
        ON gc.guild_id = ca.guild_id
      LEFT JOIN creator_profiles cp
        ON cp.guild_id = ca.guild_id
       AND cp.discord_user_id = ca.discord_user_id
      LEFT JOIN pro_entitlements pe
        ON pe.bound_guild_id = ca.guild_id
      WHERE csc.platform = $1
        AND csc.external_account_id = $2
        AND csc.status = 'active'
        AND gc.socials_feed_channel_id IS NOT NULL
      ORDER BY ca.guild_id ASC
    `,
    [platform, externalAccountId]
  );

  return result.rows.map((row) => ({
    guildId: row.guild_id,
    creatorDiscordUserId: row.creator_discord_user_id,
    creatorDisplayName: row.creator_display_name,
    channelId: row.channel_id,
    brandName: row.brand_name,
    brandLogoUrl: row.brand_logo_url,
    previewImageUrl: row.preview_image_url,
    footerText: row.footer_text,
    entitlementStatus: row.entitlement_status,
  }));
}

async function beginLivePost(payload = {}) {
  return withTransaction(async (client) => {
    const existing = await client.query(
      `
        SELECT *
        FROM post_history
        WHERE guild_id = $1
          AND platform = $2
          AND session_key = $3
        LIMIT 1
      `,
      [payload.guildId, payload.platform, payload.sessionKey]
    );

    if (existing.rows[0]?.status === "posted") {
      return {
        alreadyPosted: true,
        resumePosting: false,
        postHistory: existing.rows[0],
      };
    }

    await client.query(
      `
        INSERT INTO live_sessions (
          guild_id,
          platform,
          session_key,
          source_external_id,
          state,
          first_seen_at,
          last_seen_at
        )
        VALUES ($1, $2, $3, $4, 'active', NOW(), NOW())
        ON CONFLICT (guild_id, platform, session_key) DO UPDATE SET
          source_external_id = EXCLUDED.source_external_id,
          state = 'active',
          last_seen_at = NOW()
      `,
      [
        payload.guildId,
        payload.platform,
        payload.sessionKey,
        payload.sourceExternalId || null,
      ]
    );

    const postHistory = await client.query(
      `
        INSERT INTO post_history (
          guild_id,
          platform,
          session_key,
          status,
          discord_message_id,
          error_text,
          updated_at
        )
        VALUES ($1, $2, $3, 'posting', NULL, NULL, NOW())
        ON CONFLICT (guild_id, platform, session_key) DO UPDATE SET
          status = 'posting',
          error_text = NULL,
          updated_at = NOW()
        RETURNING *
      `,
      [payload.guildId, payload.platform, payload.sessionKey]
    );

    return {
      alreadyPosted: false,
      resumePosting: Boolean(existing.rows[0]),
      postHistory: postHistory.rows[0] || null,
    };
  });
}

async function beginSocialFeedPost(payload = {}) {
  return withTransaction(async (client) => {
    const existing = await client.query(
      `
        SELECT *
        FROM post_history
        WHERE guild_id = $1
          AND platform = $2
          AND session_key = $3
        LIMIT 1
      `,
      [payload.guildId, payload.platform, payload.sessionKey]
    );

    if (existing.rows[0]?.status === "posted") {
      return {
        alreadyPosted: true,
        resumePosting: false,
        postHistory: existing.rows[0],
      };
    }

    const postHistory = await client.query(
      `
        INSERT INTO post_history (
          guild_id,
          platform,
          session_key,
          status,
          discord_message_id,
          error_text,
          updated_at
        )
        VALUES ($1, $2, $3, 'posting', NULL, NULL, NOW())
        ON CONFLICT (guild_id, platform, session_key) DO UPDATE SET
          status = 'posting',
          error_text = NULL,
          updated_at = NOW()
        RETURNING *
      `,
      [payload.guildId, payload.platform, payload.sessionKey]
    );

    return {
      alreadyPosted: false,
      resumePosting: Boolean(existing.rows[0]),
      postHistory: postHistory.rows[0] || null,
    };
  });
}

async function markLivePostDelivered(payload = {}, discordMessage = {}) {
  return withTransaction(async (client) => {
    await ensureLiveAutomationSchema();

    await client.query(
      `
        UPDATE live_sessions
        SET
          source_external_id = COALESCE($4, source_external_id),
          state = 'active',
          last_seen_at = NOW()
        WHERE guild_id = $1
          AND platform = $2
          AND session_key = $3
      `,
      [
        payload.guildId,
        payload.platform,
        payload.sessionKey,
        payload.sourceExternalId || null,
      ]
    );

    const result = await client.query(
      `
        UPDATE post_history
        SET
          status = 'posted',
          discord_message_id = $4,
          error_text = NULL,
          updated_at = NOW()
        WHERE guild_id = $1
          AND platform = $2
          AND session_key = $3
        RETURNING *
      `,
      [
        payload.guildId,
        payload.platform,
        payload.sessionKey,
        discordMessage.id || null,
      ]
    );

    if (payload.creatorDiscordUserId) {
      await client.query(
        `
          INSERT INTO creator_live_alerts (
            guild_id,
            discord_user_id,
            platform,
            session_key,
            source_external_id,
            discord_message_id,
            title,
            category_name,
            viewer_count,
            started_at,
            posted_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()
          )
          ON CONFLICT (guild_id, discord_user_id, platform, session_key) DO UPDATE SET
            source_external_id = EXCLUDED.source_external_id,
            discord_message_id = EXCLUDED.discord_message_id,
            title = EXCLUDED.title,
            category_name = EXCLUDED.category_name,
            viewer_count = EXCLUDED.viewer_count,
            started_at = EXCLUDED.started_at,
            updated_at = NOW()
        `,
        [
          payload.guildId,
          payload.creatorDiscordUserId,
          payload.platform,
          payload.sessionKey,
          payload.sourceExternalId || null,
          discordMessage.id || null,
          payload.payload?.title || null,
          payload.payload?.game_name || null,
          Number.isFinite(Number(payload.payload?.viewer_count))
            ? Number(payload.payload.viewer_count)
            : null,
          payload.payload?.started_at || payload.sourceCreatedAt || null,
        ]
      );
    }

    return result.rows[0] || null;
  });
}

async function markSocialFeedPostDelivered(payload = {}, discordMessage = {}) {
  const result = await query(
    `
      UPDATE post_history
      SET
        status = 'posted',
        discord_message_id = $4,
        error_text = NULL,
        updated_at = NOW()
      WHERE guild_id = $1
        AND platform = $2
        AND session_key = $3
      RETURNING *
    `,
    [
      payload.guildId,
      payload.platform,
      payload.sessionKey,
      discordMessage.id || null,
    ]
  );

  return result.rows[0] || null;
}

async function markLivePostFailed(payload = {}, errorText) {
  const result = await query(
    `
      UPDATE post_history
      SET
        status = 'failed',
        error_text = $4,
        updated_at = NOW()
      WHERE guild_id = $1
        AND platform = $2
        AND session_key = $3
      RETURNING *
    `,
    [
      payload.guildId,
      payload.platform,
      payload.sessionKey,
      String(errorText || "Unknown error"),
    ]
  );

  return result.rows[0] || null;
}

async function markSocialFeedPostFailed(payload = {}, errorText) {
  const result = await query(
    `
      UPDATE post_history
      SET
        status = 'failed',
        error_text = $4,
        updated_at = NOW()
      WHERE guild_id = $1
        AND platform = $2
        AND session_key = $3
      RETURNING *
    `,
    [
      payload.guildId,
      payload.platform,
      payload.sessionKey,
      String(errorText || "Unknown error"),
    ]
  );

  return result.rows[0] || null;
}

async function getCleanupTargets(platform, sourceExternalId) {
  await ensureLiveAutomationSchema();

  const result = await query(
    `
      SELECT
        ls.guild_id,
        ls.platform,
        ls.session_key,
        COALESCE(ph.discord_message_id, cla.discord_message_id) AS discord_message_id,
        COALESCE(gc.live_channel_id, gc.announce_channel_id) AS channel_id,
        gc.auto_cleanup,
        gc.stream_end_message_enabled,
        gc.stream_end_message_template
      FROM live_sessions ls
      LEFT JOIN post_history ph
        ON ph.guild_id = ls.guild_id
       AND ph.platform = ls.platform
       AND ph.session_key = ls.session_key
      LEFT JOIN creator_live_alerts cla
        ON cla.guild_id = ls.guild_id
       AND cla.platform = ls.platform
       AND cla.session_key = ls.session_key
      LEFT JOIN guild_config gc
        ON gc.guild_id = ls.guild_id
      WHERE ls.platform = $1
        AND ls.source_external_id = $2
        AND ls.state = 'active'
    `,
    [platform, sourceExternalId]
  );

  return result.rows;
}

async function markLiveSessionsInactive(platform, sourceExternalId) {
  const result = await query(
    `
      UPDATE live_sessions
      SET
        state = 'inactive',
        last_seen_at = NOW()
      WHERE platform = $1
        AND source_external_id = $2
        AND state = 'active'
      RETURNING *
    `,
    [platform, sourceExternalId]
  );

  return result.rows;
}

async function markLivePostCleared(guildId, platform, sessionKey) {
  const result = await query(
    `
      UPDATE post_history
      SET
        status = 'cleared',
        updated_at = NOW()
      WHERE guild_id = $1
        AND platform = $2
        AND session_key = $3
      RETURNING *
    `,
    [guildId, platform, sessionKey]
  );

  return result.rows[0] || null;
}

async function getCreatorDispatch(dispatchId) {
  const result = await query(
    `
      SELECT *
      FROM creator_post_dispatches
      WHERE dispatch_id = $1
    `,
    [dispatchId]
  );

  return result.rows[0] || null;
}

async function createCreatorPostDispatch(discordUserId, patch = {}) {
  await ensureLiveAutomationSchema();

  const result = await query(
    `
      INSERT INTO creator_post_dispatches (
        discord_user_id,
        template_id,
        status,
        scheduled_at,
        source_type,
        source_key,
        target_platforms_json,
        payload_json,
        error_json,
        updated_at
      )
      VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7::jsonb, $8::jsonb, '{}'::jsonb, NOW())
      ON CONFLICT (discord_user_id, source_type, source_key)
      WHERE source_type IS NOT NULL AND source_key IS NOT NULL
      DO UPDATE SET
        template_id = COALESCE(EXCLUDED.template_id, creator_post_dispatches.template_id),
        status = EXCLUDED.status,
        scheduled_at = EXCLUDED.scheduled_at,
        target_platforms_json = EXCLUDED.target_platforms_json,
        payload_json = EXCLUDED.payload_json,
        error_json = '{}'::jsonb,
        updated_at = NOW()
      RETURNING *
    `,
    [
      discordUserId,
      patch.template_id || null,
      patch.status || "queued",
      patch.scheduled_at || null,
      patch.source_type || null,
      patch.source_key || null,
      JSON.stringify(Array.isArray(patch.target_platforms_json) ? patch.target_platforms_json : []),
      JSON.stringify(patch.payload_json || {}),
    ]
  );

  return result.rows[0] || null;
}

async function getCreatorConnections(discordUserId, platforms = []) {
  const normalizedPlatforms = Array.from(new Set(
    (Array.isArray(platforms) ? platforms : [])
      .map((platform) => String(platform || "").trim().toLowerCase())
      .filter(Boolean)
  ));
  const platformFilter = normalizedPlatforms.length
    ? "AND platform = ANY($2::text[])"
    : "";
  const params = normalizedPlatforms.length
    ? [discordUserId, normalizedPlatforms]
    : [discordUserId];

  const result = await query(
    `
      SELECT
        connection_id,
        platform,
        status,
        external_account_id,
        external_account_name,
        access_token,
        refresh_token,
        token_expires_at,
        metadata_json
      FROM creator_social_connections
      WHERE discord_user_id = $1
        ${platformFilter}
    `,
    params
  );

  return result.rows;
}

async function recordSocialPublication({
  dispatchId,
  discordUserId,
  platform,
  connectionId = null,
  status = "queued",
  originKey = null,
  originFingerprint = null,
  externalAccountId = null,
  payloadJson = {},
  markerJson = {},
  errorJson = {},
}) {
  const resolvedOriginKey = originKey || buildSocialOriginKey({
    platform,
    dispatchId,
  });

  if (!resolvedOriginKey) {
    throw new Error("A social publication origin key is required.");
  }

  const result = await query(
    `
      INSERT INTO social_post_publications (
        dispatch_id,
        discord_user_id,
        platform,
        connection_id,
        status,
        origin_key,
        origin_fingerprint,
        external_account_id,
        payload_json,
        marker_json,
        error_json,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9::jsonb, $10::jsonb, $11::jsonb, NOW()
      )
      ON CONFLICT (platform, origin_key) DO UPDATE SET
        dispatch_id = EXCLUDED.dispatch_id,
        discord_user_id = EXCLUDED.discord_user_id,
        connection_id = COALESCE(EXCLUDED.connection_id, social_post_publications.connection_id),
        status = EXCLUDED.status,
        origin_fingerprint = COALESCE(EXCLUDED.origin_fingerprint, social_post_publications.origin_fingerprint),
        external_account_id = COALESCE(EXCLUDED.external_account_id, social_post_publications.external_account_id),
        payload_json = EXCLUDED.payload_json,
        marker_json = EXCLUDED.marker_json,
        error_json = EXCLUDED.error_json,
        updated_at = NOW()
      RETURNING *
    `,
    [
      dispatchId,
      discordUserId,
      platform,
      connectionId,
      status,
      resolvedOriginKey,
      originFingerprint,
      externalAccountId,
      JSON.stringify(payloadJson || {}),
      JSON.stringify(markerJson || {}),
      JSON.stringify(errorJson || {}),
    ]
  );

  return result.rows[0] || null;
}

async function updateSocialPublication(publicationId, patch = {}) {
  const result = await query(
    `
      UPDATE social_post_publications
      SET
        status = COALESCE($2, status),
        origin_fingerprint = COALESCE($3, origin_fingerprint),
        external_account_id = COALESCE($4, external_account_id),
        external_post_id = COALESCE($5, external_post_id),
        external_parent_post_id = COALESCE($6, external_parent_post_id),
        external_app_id = COALESCE($7, external_app_id),
        external_url = COALESCE($8, external_url),
        external_created_at = COALESCE($9::timestamptz, external_created_at),
        payload_json = COALESCE($10::jsonb, payload_json),
        marker_json = COALESCE($11::jsonb, marker_json),
        error_json = COALESCE($12::jsonb, error_json),
        updated_at = NOW()
      WHERE publication_id = $1
      RETURNING *
    `,
    [
      publicationId,
      patch.status || null,
      patch.originFingerprint || null,
      patch.externalAccountId || null,
      patch.externalPostId || null,
      patch.externalParentPostId || null,
      patch.externalAppId || null,
      patch.externalUrl || null,
      patch.externalCreatedAt || null,
      Object.prototype.hasOwnProperty.call(patch, "payloadJson")
        ? JSON.stringify(patch.payloadJson || {})
        : null,
      Object.prototype.hasOwnProperty.call(patch, "markerJson")
        ? JSON.stringify(patch.markerJson || {})
        : null,
      Object.prototype.hasOwnProperty.call(patch, "errorJson")
        ? JSON.stringify(patch.errorJson || {})
        : null,
    ]
  );

  return result.rows[0] || null;
}

async function updateCreatorDispatch(dispatchId, status, errorJson = {}) {
  const result = await query(
    `
      UPDATE creator_post_dispatches
      SET
        status = $2,
        error_json = $3::jsonb,
        updated_at = NOW()
      WHERE dispatch_id = $1
      RETURNING *
    `,
    [
      dispatchId,
      status,
      JSON.stringify(errorJson || {}),
    ]
  );

  return result.rows[0] || null;
}

async function recordAutomationActivity(discordUserId, event = {}) {
  await ensureLiveAutomationSchema();
  const result = await query(
    `
      INSERT INTO automation_activity_events (
        discord_user_id,
        event_type,
        title,
        body,
        severity,
        platform,
        dispatch_id,
        publication_id,
        source_type,
        source_key,
        metadata_json,
        push_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
      ON CONFLICT (discord_user_id, source_type, source_key)
      WHERE source_type IS NOT NULL AND source_key IS NOT NULL
      DO UPDATE SET
        event_type = EXCLUDED.event_type,
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        severity = EXCLUDED.severity,
        platform = EXCLUDED.platform,
        dispatch_id = COALESCE(EXCLUDED.dispatch_id, automation_activity_events.dispatch_id),
        publication_id = COALESCE(EXCLUDED.publication_id, automation_activity_events.publication_id),
        metadata_json = EXCLUDED.metadata_json,
        push_status = CASE
          WHEN automation_activity_events.push_status = 'sent' THEN automation_activity_events.push_status
          ELSE EXCLUDED.push_status
        END
      RETURNING *
    `,
    [
      discordUserId,
      String(event.event_type || event.eventType || "automation.event").trim().toLowerCase(),
      String(event.title || "WatchMe activity").trim(),
      event.body ? String(event.body).trim() : null,
      String(event.severity || "info").trim().toLowerCase(),
      event.platform ? String(event.platform).trim().toLowerCase() : null,
      event.dispatch_id || event.dispatchId || null,
      event.publication_id || event.publicationId || null,
      event.source_type || event.sourceType || null,
      event.source_key || event.sourceKey || null,
      JSON.stringify(event.metadata_json || event.metadataJson || {}),
      event.push_status || event.pushStatus || "pending",
    ]
  );

  return result.rows[0] || null;
}

async function recordAutomationActivityAndQueuePush(discordUserId, event = {}) {
  const activity = await recordAutomationActivity(discordUserId, event);
  if (activity?.activity_id) {
    await enqueueMobilePushJob(activity.activity_id, discordUserId, {
      eventType: activity.event_type,
    }).catch(() => null);
  }
  return activity;
}

async function getAutomationActivity(activityId) {
  await ensureLiveAutomationSchema();
  const result = await query(
    `
      SELECT *
      FROM automation_activity_events
      WHERE activity_id = $1
      LIMIT 1
    `,
    [activityId]
  );

  return result.rows[0] || null;
}

async function getActiveMobilePushDevices(discordUserId) {
  await ensureLiveAutomationSchema();
  const result = await query(
    `
      SELECT device_id, discord_user_id, push_token, device_platform, app_version, status
      FROM mobile_push_devices
      WHERE discord_user_id = $1
        AND status = 'active'
      ORDER BY updated_at DESC
    `,
    [discordUserId]
  );

  return result.rows;
}

async function recordMobilePushDelivery(patch = {}) {
  await ensureLiveAutomationSchema();
  const result = await query(
    `
      INSERT INTO mobile_push_deliveries (
        activity_id,
        device_id,
        discord_user_id,
        status,
        error_text,
        response_json,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
      RETURNING *
    `,
    [
      patch.activity_id || patch.activityId || null,
      patch.device_id || patch.deviceId || null,
      patch.discord_user_id || patch.discordUserId,
      patch.status || "failed",
      patch.error_text || patch.errorText || null,
      JSON.stringify(patch.response_json || patch.responseJson || {}),
    ]
  );

  return result.rows[0] || null;
}

async function markAutomationActivityPushStatus(activityId, status) {
  await ensureLiveAutomationSchema();
  const result = await query(
    `
      UPDATE automation_activity_events
      SET push_status = $2
      WHERE activity_id = $1
      RETURNING *
    `,
    [activityId, status]
  );

  return result.rows[0] || null;
}

async function upsertWorkerHeartbeat(snapshot = {}, options = {}) {
  await ensureWorkerHeartbeatSchema();

  const workerName = String(options.workerName || snapshot.workerName || "").trim();
  if (!workerName) {
    throw new Error("workerName is required for worker heartbeat updates.");
  }

  const processInfo = snapshot.process || {};
  const result = await query(
    `
      WITH start_event AS (
        INSERT INTO worker_start_events (
          worker_name,
          started_at
        )
        SELECT
          $1,
          $6::timestamptz
        WHERE $6::timestamptz IS NOT NULL
        ON CONFLICT (worker_name, started_at) DO NOTHING
      )
      INSERT INTO worker_heartbeats (
        worker_name,
        status,
        node_env,
        queues_json,
        process_id,
        started_at,
        last_seen_at,
        last_tick_started_at,
        last_tick_finished_at,
        tick_in_progress,
        total_ticks,
        total_jobs_claimed,
        total_jobs_completed,
        total_jobs_failed,
        total_stale_locks_released,
        last_subscription_sweep_at,
        last_subscription_sweep_count,
        last_error,
        uptime_seconds,
        rss_bytes,
        heap_used_bytes,
        heap_total_bytes,
        external_bytes,
        array_buffers_bytes,
        max_rss_bytes,
        max_heap_used_bytes,
        sample_count,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4::jsonb, $5, $6::timestamptz, NOW(),
        $7::timestamptz, $8::timestamptz, $9, $10, $11, $12, $13, $14,
        $15::timestamptz, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, NOW()
      )
      ON CONFLICT (worker_name) DO UPDATE SET
        status = EXCLUDED.status,
        node_env = EXCLUDED.node_env,
        queues_json = EXCLUDED.queues_json,
        process_id = EXCLUDED.process_id,
        started_at = COALESCE(EXCLUDED.started_at, worker_heartbeats.started_at),
        last_seen_at = NOW(),
        last_tick_started_at = COALESCE(EXCLUDED.last_tick_started_at, worker_heartbeats.last_tick_started_at),
        last_tick_finished_at = COALESCE(EXCLUDED.last_tick_finished_at, worker_heartbeats.last_tick_finished_at),
        tick_in_progress = EXCLUDED.tick_in_progress,
        total_ticks = EXCLUDED.total_ticks,
        total_jobs_claimed = EXCLUDED.total_jobs_claimed,
        total_jobs_completed = EXCLUDED.total_jobs_completed,
        total_jobs_failed = EXCLUDED.total_jobs_failed,
        total_stale_locks_released = EXCLUDED.total_stale_locks_released,
        last_subscription_sweep_at = COALESCE(EXCLUDED.last_subscription_sweep_at, worker_heartbeats.last_subscription_sweep_at),
        last_subscription_sweep_count = EXCLUDED.last_subscription_sweep_count,
        last_error = EXCLUDED.last_error,
        uptime_seconds = EXCLUDED.uptime_seconds,
        rss_bytes = EXCLUDED.rss_bytes,
        heap_used_bytes = EXCLUDED.heap_used_bytes,
        heap_total_bytes = EXCLUDED.heap_total_bytes,
        external_bytes = EXCLUDED.external_bytes,
        array_buffers_bytes = EXCLUDED.array_buffers_bytes,
        max_rss_bytes = EXCLUDED.max_rss_bytes,
        max_heap_used_bytes = EXCLUDED.max_heap_used_bytes,
        sample_count = EXCLUDED.sample_count,
        updated_at = NOW()
      RETURNING *
    `,
    [
      workerName,
      String(options.status || "running").trim().toLowerCase() || "running",
      snapshot.nodeEnv || null,
      JSON.stringify(Array.isArray(snapshot.queues) ? snapshot.queues : []),
      processInfo.pid || null,
      snapshot.startedAt || null,
      snapshot.lastTickStartedAt || null,
      snapshot.lastTickFinishedAt || null,
      Boolean(snapshot.tickInProgress),
      Number(snapshot.totalTicks || 0),
      Number(snapshot.totalJobsClaimed || 0),
      Number(snapshot.totalJobsCompleted || 0),
      Number(snapshot.totalJobsFailed || 0),
      Number(snapshot.totalStaleLocksReleased || 0),
      snapshot.lastSubscriptionSweepAt || null,
      Number(snapshot.lastSubscriptionSweepCount || 0),
      snapshot.lastError || null,
      Number(processInfo.uptimeSeconds || 0),
      Number(processInfo.rssBytes || 0),
      Number(processInfo.heapUsedBytes || 0),
      Number(processInfo.heapTotalBytes || 0),
      Number(processInfo.externalBytes || 0),
      Number(processInfo.arrayBuffersBytes || 0),
      Number(processInfo.maxRssBytes || 0),
      Number(processInfo.maxHeapUsedBytes || 0),
      Number(processInfo.sampleCount || 0),
    ]
  );

  return result.rows[0] || null;
}

async function markWorkerHeartbeatStopped(workerName, snapshot = {}) {
  if (!String(workerName || "").trim()) {
    return null;
  }

  return upsertWorkerHeartbeat(
    {
      ...snapshot,
      workerName,
    },
    {
      workerName,
      status: "stopped",
    }
  );
}

module.exports = {
  ensureWorkerHeartbeatSchema,
  ensureLiveAutomationSchema,
  beginSocialFeedPost,
  beginLivePost,
  createCreatorPostDispatch,
  enqueueLivePostJob,
  enqueueMobilePushJob,
  enqueueSocialFeedPostJob,
  enqueueSocialPostDispatchJob,
  enqueuePlatformEventJob,
  enqueuePlatformSubscriptionRenewalJob,
  enqueueProcessLiveEvent,
  enqueueProcessSocialEvent,
  getCleanupTargets,
  getCreatorConnections,
  getCreatorDispatch,
  getActiveMobilePushDevices,
  getAutomationActivity,
  getEventById,
  getLiveEventTargets,
  getSocialEventTargets,
  findPlatformSubscriptionsForSync,
  getPlatformSubscriptionsDueForRenewal,
  getPlatformSubscriptionById,
  buildLivePostDedupeKey,
  buildScopedLiveSessionKey,
  normalizeProductScope,
  ingestPlatformEvent,
  markSocialFeedPostDelivered,
  markSocialFeedPostFailed,
  markAutomationActivityPushStatus,
  recordSocialPublication,
  recordAutomationActivity,
  recordAutomationActivityAndQueuePush,
  recordMobilePushDelivery,
  syncPlatformSubscriptionsToCanonicalTopic,
  markLivePostCleared,
  markLivePostDelivered,
  markLivePostFailed,
  markLiveSessionsInactive,
  touchPlatformSubscription,
  updateCreatorDispatch,
  updateEventState,
  updatePlatformSubscriptionById,
  updatePlatformSubscriptionsByTopic,
  updateSocialPublication,
  upsertWorkerHeartbeat,
  markWorkerHeartbeatStopped,
};
