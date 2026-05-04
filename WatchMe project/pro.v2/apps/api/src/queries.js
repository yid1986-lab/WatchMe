const {
  buildEventDedupeKey,
  buildPlatformTopicKey,
} = require("../../../packages/shared/src");
const { query, withTransaction } = require("./db");
let workerHeartbeatSchemaEnsured = false;
let phaseOneWorkspaceSchemaEnsured = false;

const CREATOR_SOCIAL_PLATFORMS = ["facebook", "instagram", "x", "tiktok", "youtube", "twitch"];

function ageSeconds(value) {
  if (!value) return null;
  const timestamp = new Date(value);
  const next = timestamp.getTime();
  if (!Number.isFinite(next)) return null;
  return Math.max(0, Math.floor((Date.now() - next) / 1000));
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  const rounded = size >= 10 || index === 0 ? Math.round(size) : Number(size.toFixed(1));
  return `${rounded} ${units[index]}`;
}

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

async function ensurePhaseOneWorkspaceSchema() {
  if (phaseOneWorkspaceSchemaEnsured) {
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

    CREATE TABLE IF NOT EXISTS guild_keyword_filters (
      guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
      platform TEXT NOT NULL DEFAULT 'all',
      keyword TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, platform, keyword)
    );

    CREATE INDEX IF NOT EXISTS guild_keyword_filters_guild_idx
      ON guild_keyword_filters (guild_id);

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

    CREATE TABLE IF NOT EXISTS social_origin_decisions (
      decision_id BIGSERIAL PRIMARY KEY,
      platform TEXT NOT NULL,
      external_account_id TEXT,
      external_post_id TEXT,
      accepted BOOLEAN NOT NULL,
      reason TEXT,
      match_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      candidate_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS social_origin_decisions_created_idx
      ON social_origin_decisions (created_at DESC);

    CREATE INDEX IF NOT EXISTS social_origin_decisions_platform_created_idx
      ON social_origin_decisions (platform, created_at DESC);

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

    CREATE TABLE IF NOT EXISTS social_oauth_states (
      state TEXT PRIMARY KEY,
      discord_user_id TEXT NOT NULL REFERENCES users(discord_user_id),
      platform TEXT NOT NULL,
      return_target TEXT NOT NULL DEFAULT 'mobile',
      pkce_verifier TEXT,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS social_oauth_states_user_created_idx
      ON social_oauth_states (discord_user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS social_oauth_states_expiry_idx
      ON social_oauth_states (expires_at, used_at);
  `);

  phaseOneWorkspaceSchemaEnsured = true;
}

async function createSocialOAuthState({
  state,
  discordUserId,
  platform,
  returnTarget = "mobile",
  pkceVerifier = null,
  metadata = {},
  ttlMinutes = 15,
}) {
  await ensurePhaseOneWorkspaceSchema();
  await ensureUser(discordUserId);

  const result = await query(
    `
      INSERT INTO social_oauth_states (
        state,
        discord_user_id,
        platform,
        return_target,
        pkce_verifier,
        metadata_json,
        expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW() + ($7::text || ' minutes')::interval)
      RETURNING *
    `,
    [
      state,
      discordUserId,
      platform,
      returnTarget || "mobile",
      pkceVerifier || null,
      JSON.stringify(metadata || {}),
      String(Math.max(1, Math.min(60, Number(ttlMinutes || 15)))),
    ]
  );

  return result.rows[0] || null;
}

async function consumeSocialOAuthState(state) {
  await ensurePhaseOneWorkspaceSchema();

  return await withTransaction(async (client) => {
    const found = await client.query(
      `
        SELECT *
        FROM social_oauth_states
        WHERE state = $1
        FOR UPDATE
      `,
      [state]
    );
    const row = found.rows[0] || null;
    if (!row) {
      return { ok: false, error: "OAuth state was not found." };
    }
    if (row.used_at) {
      return { ok: false, error: "OAuth state was already used.", state: row };
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return { ok: false, error: "OAuth state expired.", state: row };
    }

    const updated = await client.query(
      `
        UPDATE social_oauth_states
        SET used_at = NOW()
        WHERE state = $1
        RETURNING *
      `,
      [state]
    );
    return { ok: true, state: updated.rows[0] };
  });
}

function normalizeMatchValue(value, { lowerCase = true } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }

  return lowerCase ? normalized.toLowerCase() : normalized;
}

function normalizeMatchList(values = [], { lowerCase = true } = {}) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [values])
        .map((value) => normalizeMatchValue(value, { lowerCase }))
        .filter(Boolean)
    )
  );
}

function getCandidatePostMatchSets(candidate = {}) {
  const directPostIds = normalizeMatchList([
    candidate.external_post_id,
    candidate.external_parent_post_id,
  ]);
  const relatedPostIds = normalizeMatchList([
    candidate.repost_of_external_post_id,
    candidate.quote_of_external_post_id,
    candidate.shared_external_post_id,
    ...(Array.isArray(candidate.related_post_ids) ? candidate.related_post_ids : []),
  ]);

  return {
    directPostIds,
    relatedPostIds,
    allPostIds: Array.from(new Set([...directPostIds, ...relatedPostIds])),
  };
}

function getPublicationPostIds(publication = {}) {
  return normalizeMatchList([
    publication.external_post_id,
    publication.external_parent_post_id,
  ]);
}

async function findSocialPublicationsByExternalIds(platform, externalIds = []) {
  const normalizedPlatform = normalizeMatchValue(platform);
  const matchIds = normalizeMatchList(externalIds);

  if (!normalizedPlatform || !matchIds.length) {
    return [];
  }

  const result = await query(
    `
      SELECT *
      FROM social_post_publications
      WHERE platform = $1
        AND (
          LOWER(COALESCE(external_post_id, '')) = ANY($2::text[])
          OR LOWER(COALESCE(external_parent_post_id, '')) = ANY($2::text[])
        )
      ORDER BY external_created_at DESC NULLS LAST, publication_id DESC
      LIMIT 20
    `,
    [normalizedPlatform, matchIds]
  );

  return result.rows;
}

async function findSocialPublicationsByExternalAppIds(platform, externalAppIds = []) {
  const normalizedPlatform = normalizeMatchValue(platform);
  const matchIds = normalizeMatchList(externalAppIds);

  if (!normalizedPlatform || !matchIds.length) {
    return [];
  }

  const result = await query(
    `
      SELECT *
      FROM social_post_publications
      WHERE platform = $1
        AND LOWER(COALESCE(external_app_id, '')) = ANY($2::text[])
      ORDER BY external_created_at DESC NULLS LAST, publication_id DESC
      LIMIT 20
    `,
    [normalizedPlatform, matchIds]
  );

  return result.rows;
}

async function findSocialPublicationsByOriginMarkers(platform, originKeys = [], originFingerprints = []) {
  const normalizedPlatform = normalizeMatchValue(platform);
  const matchOriginKeys = normalizeMatchList(originKeys);
  const matchOriginFingerprints = normalizeMatchList(originFingerprints);

  if (!normalizedPlatform || (!matchOriginKeys.length && !matchOriginFingerprints.length)) {
    return [];
  }

  const params = [
    normalizedPlatform,
    matchOriginKeys.length ? matchOriginKeys : [""],
    matchOriginFingerprints.length ? matchOriginFingerprints : [""],
  ];
  const conditions = [];

  if (matchOriginKeys.length) {
    conditions.push(`LOWER(COALESCE(origin_key, '')) = ANY($2::text[])`);
  }

  if (matchOriginFingerprints.length) {
    conditions.push(`LOWER(COALESCE(origin_fingerprint, '')) = ANY($3::text[])`);
  }

  const result = await query(
    `
      SELECT *
      FROM social_post_publications
      WHERE platform = $1
        AND (${conditions.join(" OR ")})
      ORDER BY external_created_at DESC NULLS LAST, publication_id DESC
      LIMIT 20
    `,
    params
  );

  return result.rows;
}

function classifySocialPublicationMatch(candidate = {}, publication = {}) {
  const { directPostIds, relatedPostIds } = getCandidatePostMatchSets(candidate);
  const publicationPostIds = getPublicationPostIds(publication);

  if (directPostIds.some((value) => publicationPostIds.includes(value))) {
    return {
      matchType: "external_post",
      reason: "watchme_origin_external_post",
    };
  }

  if (relatedPostIds.some((value) => publicationPostIds.includes(value))) {
    return {
      matchType: "repost_ancestry",
      reason: "watchme_origin_repost_ancestry",
    };
  }

  const appIds = normalizeMatchList([
    candidate.external_app_id,
    ...(Array.isArray(candidate.external_app_ids) ? candidate.external_app_ids : []),
  ]);
  const publicationAppId = normalizeMatchValue(publication.external_app_id);
  if (publicationAppId && appIds.includes(publicationAppId)) {
    return {
      matchType: "external_app_id",
      reason: "watchme_origin_external_app",
    };
  }

  const originKeys = normalizeMatchList(candidate.origin_keys);
  const originFingerprints = normalizeMatchList(candidate.origin_fingerprints);
  const publicationOriginKey = normalizeMatchValue(publication.origin_key);
  const publicationOriginFingerprint = normalizeMatchValue(publication.origin_fingerprint);

  if (
    (publicationOriginKey && originKeys.includes(publicationOriginKey)) ||
    (publicationOriginFingerprint && originFingerprints.includes(publicationOriginFingerprint))
  ) {
    return {
      matchType: "origin_marker",
      reason: "watchme_origin_marker",
    };
  }

  return null;
}

async function evaluateSocialOriginCandidate(candidate = {}) {
  const normalizedPlatform = normalizeMatchValue(candidate.platform);
  if (!normalizedPlatform) {
    throw new Error("platform is required for social origin evaluation.");
  }

  const { allPostIds } = getCandidatePostMatchSets(candidate);
  const externalAppIds = normalizeMatchList([
    candidate.external_app_id,
    ...(Array.isArray(candidate.external_app_ids) ? candidate.external_app_ids : []),
  ]);
  const originKeys = normalizeMatchList(candidate.origin_keys);
  const originFingerprints = normalizeMatchList(candidate.origin_fingerprints);

  const postMatches = await findSocialPublicationsByExternalIds(normalizedPlatform, allPostIds);
  for (const publication of postMatches) {
    const match = classifySocialPublicationMatch(candidate, publication);
    if (match) {
      return {
        accepted: false,
        rejected: true,
        reason: match.reason,
        match: {
          publication_id: publication.publication_id,
          discord_user_id: publication.discord_user_id,
          platform: publication.platform,
          status: publication.status,
          dispatch_id: publication.dispatch_id,
          external_account_id: publication.external_account_id,
          external_post_id: publication.external_post_id,
          external_parent_post_id: publication.external_parent_post_id,
          external_app_id: publication.external_app_id,
          origin_key: publication.origin_key,
          origin_fingerprint: publication.origin_fingerprint,
          match_type: match.matchType,
        },
      };
    }
  }

  const appMatches = await findSocialPublicationsByExternalAppIds(normalizedPlatform, externalAppIds);
  for (const publication of appMatches) {
    const match = classifySocialPublicationMatch(candidate, publication);
    if (match) {
      return {
        accepted: false,
        rejected: true,
        reason: match.reason,
        match: {
          publication_id: publication.publication_id,
          discord_user_id: publication.discord_user_id,
          platform: publication.platform,
          status: publication.status,
          dispatch_id: publication.dispatch_id,
          external_account_id: publication.external_account_id,
          external_post_id: publication.external_post_id,
          external_parent_post_id: publication.external_parent_post_id,
          external_app_id: publication.external_app_id,
          origin_key: publication.origin_key,
          origin_fingerprint: publication.origin_fingerprint,
          match_type: match.matchType,
        },
      };
    }
  }

  const markerMatches = await findSocialPublicationsByOriginMarkers(
    normalizedPlatform,
    originKeys,
    originFingerprints
  );
  for (const publication of markerMatches) {
    const match = classifySocialPublicationMatch(candidate, publication);
    if (match) {
      return {
        accepted: false,
        rejected: true,
        reason: match.reason,
        match: {
          publication_id: publication.publication_id,
          discord_user_id: publication.discord_user_id,
          platform: publication.platform,
          status: publication.status,
          dispatch_id: publication.dispatch_id,
          external_account_id: publication.external_account_id,
          external_post_id: publication.external_post_id,
          external_parent_post_id: publication.external_parent_post_id,
          external_app_id: publication.external_app_id,
          origin_key: publication.origin_key,
          origin_fingerprint: publication.origin_fingerprint,
          match_type: match.matchType,
        },
      };
    }
  }

  return {
    accepted: true,
    rejected: false,
    reason: null,
    match: null,
  };
}

async function recordSocialOriginDecision(candidate = {}, evaluation = {}) {
  await ensurePhaseOneWorkspaceSchema();

  const result = await query(
    `
      INSERT INTO social_origin_decisions (
        platform,
        external_account_id,
        external_post_id,
        accepted,
        reason,
        match_json,
        candidate_json
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
      RETURNING *
    `,
    [
      String(candidate.platform || "").trim().toLowerCase() || "unknown",
      candidate.external_account_id || null,
      candidate.external_post_id || null,
      Boolean(evaluation.accepted),
      evaluation.reason || null,
      JSON.stringify(evaluation.match || {}),
      JSON.stringify(candidate || {}),
    ]
  );

  return result.rows[0] || null;
}

async function recordAutomationActivity(discordUserId, event = {}) {
  const userId = String(discordUserId || "").trim();
  if (!userId) {
    throw new Error("discordUserId is required for automation activity.");
  }

  await ensureUser(userId);
  await ensurePhaseOneWorkspaceSchema();

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
      userId,
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

async function listAutomationActivity(discordUserId, options = {}) {
  await ensurePhaseOneWorkspaceSchema();
  const limit = Math.max(1, Math.min(100, Number(options.limit || 50)));
  const cursor = Number(options.cursor || 0);
  const params = [discordUserId, limit];
  const cursorFilter = cursor > 0 ? "AND activity_id < $3" : "";
  if (cursor > 0) {
    params.push(cursor);
  }

  const result = await query(
    `
      SELECT *
      FROM automation_activity_events
      WHERE discord_user_id = $1
        ${cursorFilter}
      ORDER BY activity_id DESC
      LIMIT $2
    `,
    params
  );

  const items = result.rows;
  return {
    items,
    next_cursor: items.length === limit ? items[items.length - 1].activity_id : null,
  };
}

async function registerMobilePushDevice(discordUserId, patch = {}) {
  const pushToken = String(patch.push_token || patch.pushToken || "").trim();
  if (!pushToken) {
    throw new Error("push_token is required");
  }

  await ensureUser(discordUserId);
  await ensurePhaseOneWorkspaceSchema();

  const result = await query(
    `
      INSERT INTO mobile_push_devices (
        discord_user_id,
        push_token,
        device_platform,
        app_version,
        status,
        last_seen_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, 'active', NOW(), NOW())
      ON CONFLICT (push_token) DO UPDATE SET
        discord_user_id = EXCLUDED.discord_user_id,
        device_platform = EXCLUDED.device_platform,
        app_version = EXCLUDED.app_version,
        status = 'active',
        last_seen_at = NOW(),
        updated_at = NOW()
      RETURNING device_id, discord_user_id, device_platform, app_version, status, created_at, last_seen_at, updated_at
    `,
    [
      discordUserId,
      pushToken,
      String(patch.device_platform || patch.devicePlatform || "android").trim().toLowerCase(),
      patch.app_version || patch.appVersion || null,
    ]
  );

  return result.rows[0] || null;
}

async function disableMobilePushDevice(discordUserId, pushToken) {
  await ensurePhaseOneWorkspaceSchema();
  const result = await query(
    `
      UPDATE mobile_push_devices
      SET status = 'disabled', updated_at = NOW()
      WHERE discord_user_id = $1
        AND push_token = $2
      RETURNING device_id, discord_user_id, device_platform, app_version, status, created_at, last_seen_at, updated_at
    `,
    [discordUserId, String(pushToken || "").trim()]
  );

  return result.rows[0] || null;
}

async function getActiveMobilePushDevices(discordUserId) {
  await ensurePhaseOneWorkspaceSchema();
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
  await ensurePhaseOneWorkspaceSchema();
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
  await ensurePhaseOneWorkspaceSchema();
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

function buildQueueBreakdown(rows = []) {
  const breakdown = {};

  for (const row of Array.isArray(rows) ? rows : []) {
    const queueName = String(row?.queue_name || "unknown").trim() || "unknown";
    const status = String(row?.status || "unknown").trim() || "unknown";
    const count = Number(row?.count || 0);
    const errorCount = Number(row?.error_count || 0);
    const maxAttempts = Number(row?.max_attempts || 0);
    const oldestAvailableAt = row?.oldest_available_at || null;

    if (!breakdown[queueName]) {
      breakdown[queueName] = {
        total: 0,
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        errorCount: 0,
        maxAttempts: 0,
        oldestAvailableAt: null,
        oldestAvailableAgeSeconds: null,
      };
    }

    const bucket = breakdown[queueName];
    bucket[status] = count;
    bucket.total += count;
    bucket.errorCount += errorCount;
    bucket.maxAttempts = Math.max(bucket.maxAttempts, maxAttempts);

    if (
      oldestAvailableAt &&
      (!bucket.oldestAvailableAt || new Date(oldestAvailableAt).getTime() < new Date(bucket.oldestAvailableAt).getTime())
    ) {
      bucket.oldestAvailableAt = oldestAvailableAt;
      bucket.oldestAvailableAgeSeconds = ageSeconds(oldestAvailableAt);
    }
  }

  return breakdown;
}

function buildSocialFeedOpsSummary(jobSummaryRow = {}, ingestSummaryRow = {}, postSummaryRow = {}) {
  return {
    jobs: {
      ready: Number(jobSummaryRow.ready_jobs || 0),
      processing: Number(jobSummaryRow.processing_jobs || 0),
      failed: Number(jobSummaryRow.failed_jobs || 0),
      oldestReadyJobAt: jobSummaryRow.oldest_ready_job_at || null,
      oldestReadyAgeSeconds: ageSeconds(jobSummaryRow.oldest_ready_job_at),
    },
    ingest: {
      backlog: Number(ingestSummaryRow.backlog_events || 0),
      failed: Number(ingestSummaryRow.failed_events || 0),
      oldestBacklogEventAt: ingestSummaryRow.oldest_backlog_event_at || null,
      oldestBacklogAgeSeconds: ageSeconds(ingestSummaryRow.oldest_backlog_event_at),
    },
    posts: {
      posting: Number(postSummaryRow.posting_posts || 0),
      posted: Number(postSummaryRow.posted_posts || 0),
      failed: Number(postSummaryRow.failed_posts || 0),
    },
  };
}

function buildWorkerOpsSummary(workerSummaryRow = {}) {
  return {
    total: Number(workerSummaryRow.total_workers || 0),
    running: Number(workerSummaryRow.running_workers || 0),
    stopped: Number(workerSummaryRow.stopped_workers || 0),
    stale: Number(workerSummaryRow.stale_running_workers || 0),
    recentRunningStarts: Number(workerSummaryRow.recent_running_starts || 0),
    latestSeenAt: workerSummaryRow.latest_seen_at || null,
    latestSeenAgeSeconds: ageSeconds(workerSummaryRow.latest_seen_at),
    oldestStaleSeenAt: workerSummaryRow.oldest_stale_seen_at || null,
    oldestStaleAgeSeconds: ageSeconds(workerSummaryRow.oldest_stale_seen_at),
    maxRssBytes: Number(workerSummaryRow.max_rss_bytes || 0),
    maxHeapUsedBytes: Number(workerSummaryRow.max_heap_used_bytes || 0),
    peakRssBytes: Number(workerSummaryRow.peak_rss_bytes || 0),
    peakHeapUsedBytes: Number(workerSummaryRow.peak_heap_used_bytes || 0),
  };
}

function buildOpsWarnings(summary = {}, thresholds = {}) {
  const warnings = [];
  const lockTimeoutSeconds = Number(thresholds.lockTimeoutSeconds || 120);
  const backlogWarningSeconds = Number(thresholds.backlogWarningSeconds || 300);
  const leaseWarningSeconds = Number(thresholds.leaseWarningSeconds || 3600);
  const workerHeartbeatWarningSeconds = Number(thresholds.workerHeartbeatWarningSeconds || 90);
  const workerRssWarningBytes = Number(thresholds.workerRssWarningBytes || 0);
  const workerHeapWarningBytes = Number(thresholds.workerHeapWarningBytes || 0);
  const workerRestartStormWindowSeconds = Number(thresholds.workerRestartStormWindowSeconds ?? 0);
  const workerRestartStormMinCount = Number(thresholds.workerRestartStormMinCount ?? 0);
  const pagerDeliveryFailWindowSeconds = Number(thresholds.pagerDeliveryFailWindowSeconds ?? 0);
  const pagerDeliveryFailMinCount = Number(thresholds.pagerDeliveryFailMinCount ?? 0);
  const explicitWorkerTotal = summary.workers?.total;
  const computedWorkerTotal = Number.isFinite(Number(explicitWorkerTotal))
    ? Number(explicitWorkerTotal)
    : Math.max(
      Number(summary.workers?.running || 0) + Number(summary.workers?.stopped || 0),
      Number(summary.workers?.stale || 0)
    );

  if (Number(summary.jobs?.staleLocks || 0) > 0) {
    warnings.push({
      code: "stale_job_locks",
      severity: "critical",
      count: Number(summary.jobs.staleLocks),
      message: `${summary.jobs.staleLocks} processing job(s) are older than ${lockTimeoutSeconds}s and look stale.`,
    });
  }

  if (Number(summary.jobs?.failed || 0) > 0) {
    warnings.push({
      code: "failed_jobs",
      severity: "high",
      count: Number(summary.jobs.failed),
      message: `${summary.jobs.failed} job(s) are currently in a failed state.`,
    });
  }

  if (
    Number(summary.jobs?.ready || 0) > 0 &&
    Number(summary.jobs?.oldestReadyAgeSeconds || 0) >= backlogWarningSeconds
  ) {
    warnings.push({
      code: "job_backlog",
      severity: "high",
      count: Number(summary.jobs.ready),
      message: `Ready jobs have been waiting for ${summary.jobs.oldestReadyAgeSeconds}s, which exceeds the ${backlogWarningSeconds}s backlog threshold.`,
    });
  }

  if (
    Number(summary.ingest?.backlog || 0) > 0 &&
    Number(summary.ingest?.oldestBacklogAgeSeconds || 0) >= backlogWarningSeconds
  ) {
    warnings.push({
      code: "ingest_backlog",
      severity: "high",
      count: Number(summary.ingest.backlog),
      message: `Ingest backlog is ${summary.ingest.backlog} event(s), with the oldest waiting ${summary.ingest.oldestBacklogAgeSeconds}s.`,
    });
  }

  if (Number(summary.subscriptions?.expired || 0) > 0) {
    warnings.push({
      code: "expired_subscriptions",
      severity: "high",
      count: Number(summary.subscriptions.expired),
      message: `${summary.subscriptions.expired} active subscription(s) are past lease expiry.`,
    });
  }

  if (Number(summary.subscriptions?.revoked || 0) > 0) {
    warnings.push({
      code: "revoked_subscriptions",
      severity: "high",
      count: Number(summary.subscriptions.revoked),
      message: `${summary.subscriptions.revoked} subscription(s) are revoked and need repair.`,
    });
  }

  if (Number(summary.subscriptions?.dueSoon || 0) > 0) {
    warnings.push({
      code: "subscriptions_due_soon",
      severity: "medium",
      count: Number(summary.subscriptions.dueSoon),
      message: `${summary.subscriptions.dueSoon} active subscription(s) expire within ${leaseWarningSeconds}s.`,
    });
  }

  if (Number(summary.socialFeed?.posts?.failed || 0) > 0) {
    warnings.push({
      code: "social_feed_failed_posts",
      severity: "high",
      count: Number(summary.socialFeed.posts.failed),
      message: `${summary.socialFeed.posts.failed} social feed post(s) failed delivery and need review.`,
    });
  }

  if (Number(summary.socialFeed?.ingest?.failed || 0) > 0) {
    warnings.push({
      code: "social_feed_failed_events",
      severity: "high",
      count: Number(summary.socialFeed.ingest.failed),
      message: `${summary.socialFeed.ingest.failed} social feed event(s) are marked failed in ingest processing.`,
    });
  }

  if (
    Number(summary.socialFeed?.jobs?.ready || 0) > 0 &&
    Number(summary.socialFeed?.jobs?.oldestReadyAgeSeconds || 0) >= backlogWarningSeconds
  ) {
    warnings.push({
      code: "social_feed_job_backlog",
      severity: "high",
      count: Number(summary.socialFeed.jobs.ready),
      message: `Social feed jobs have been waiting for ${summary.socialFeed.jobs.oldestReadyAgeSeconds}s, which exceeds the ${backlogWarningSeconds}s backlog threshold.`,
    });
  }

  if (
    Number(summary.socialFeed?.ingest?.backlog || 0) > 0 &&
    Number(summary.socialFeed?.ingest?.oldestBacklogAgeSeconds || 0) >= backlogWarningSeconds
  ) {
    warnings.push({
      code: "social_feed_ingest_backlog",
      severity: "high",
      count: Number(summary.socialFeed.ingest.backlog),
      message: `Social feed ingest backlog is ${summary.socialFeed.ingest.backlog} event(s), with the oldest waiting ${summary.socialFeed.ingest.oldestBacklogAgeSeconds}s.`,
    });
  }

  if (computedWorkerTotal === 0) {
    warnings.push({
      code: "worker_heartbeat_missing",
      severity: "critical",
      count: 1,
      message: "No worker heartbeat records exist yet, so background processing may be offline.",
    });
  } else if (Number(summary.workers?.stale || 0) > 0) {
    warnings.push({
      code: "worker_heartbeat_stale",
      severity: "critical",
      count: Number(summary.workers.stale),
      message: `${summary.workers.stale} worker heartbeat(s) have not updated within ${workerHeartbeatWarningSeconds}s.`,
    });
  } else if (
    Number(summary.workers?.running || 0) === 0 &&
    Number(summary.workers?.latestSeenAgeSeconds || 0) >= workerHeartbeatWarningSeconds
  ) {
    warnings.push({
      code: "worker_heartbeat_missing",
      severity: "critical",
      count: 1,
      message: `No running worker heartbeat has been seen for ${summary.workers.latestSeenAgeSeconds}s, which exceeds the ${workerHeartbeatWarningSeconds}s threshold.`,
    });
  }

  if (
    workerRssWarningBytes > 0 &&
    Number(summary.workers?.maxRssBytes || 0) >= workerRssWarningBytes
  ) {
    warnings.push({
      code: "worker_memory_rss_high",
      severity: "high",
      count: Math.max(1, Number(summary.workers?.running || 0), computedWorkerTotal),
      message: `Worker RSS reached ${formatBytes(summary.workers.maxRssBytes)}, which exceeds the ${formatBytes(workerRssWarningBytes)} threshold.`,
    });
  }

  if (
    workerHeapWarningBytes > 0 &&
    Number(summary.workers?.maxHeapUsedBytes || 0) >= workerHeapWarningBytes
  ) {
    warnings.push({
      code: "worker_memory_heap_high",
      severity: "high",
      count: Math.max(1, Number(summary.workers?.running || 0), computedWorkerTotal),
      message: `Worker heap usage reached ${formatBytes(summary.workers.maxHeapUsedBytes)}, which exceeds the ${formatBytes(workerHeapWarningBytes)} threshold.`,
    });
  }

  if (
    workerRestartStormWindowSeconds > 0 &&
    workerRestartStormMinCount > 0 &&
    Number(summary.workers?.recentRunningStarts || 0) >= workerRestartStormMinCount
  ) {
    const recent = Number(summary.workers.recentRunningStarts || 0);
    warnings.push({
      code: "worker_restart_storm",
      severity: "critical",
      count: recent,
      message: `${recent} worker start event(s) were recorded for currently running workers within the last ${workerRestartStormWindowSeconds}s (threshold ${workerRestartStormMinCount}), which may indicate a coordinated restart or crash loop.`,
    });
  }

  if (
    pagerDeliveryFailWindowSeconds > 0 &&
    pagerDeliveryFailMinCount > 0 &&
    Number(summary.pager?.failedDeliveriesInWindow || 0) >= pagerDeliveryFailMinCount
  ) {
    const failed = Number(summary.pager.failedDeliveriesInWindow || 0);
    warnings.push({
      code: "pager_webhook_delivery_failures",
      severity: "critical",
      count: failed,
      message: `${failed} pager Discord webhook delivery attempt(s) failed in the last ${pagerDeliveryFailWindowSeconds}s.`,
    });
  }

  return warnings;
}

async function ensureGuild(guildId, patch = {}) {
  if (!guildId) return null;

  const result = await query(
    `
      INSERT INTO guilds (
        guild_id,
        name,
        icon_url,
        updated_at
      )
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (guild_id) DO UPDATE SET
        name = COALESCE(EXCLUDED.name, guilds.name),
        icon_url = COALESCE(EXCLUDED.icon_url, guilds.icon_url),
        updated_at = NOW()
      RETURNING *
    `,
    [
      guildId,
      patch.name || null,
      patch.icon_url || null,
    ]
  );

  return result.rows[0] || null;
}

async function ensureUser(discordUserId, patch = {}) {
  if (!discordUserId) return null;

  const result = await query(
    `
      INSERT INTO users (
        discord_user_id,
        username,
        avatar_url,
        updated_at
      )
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (discord_user_id) DO UPDATE SET
        username = COALESCE(EXCLUDED.username, users.username),
        avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
        updated_at = NOW()
      RETURNING *
    `,
    [
      discordUserId,
      patch.username || null,
      patch.avatar_url || null,
    ]
  );

  return result.rows[0] || null;
}

async function getUser(discordUserId) {
  const result = await query(
    `
      SELECT *
      FROM users
      WHERE discord_user_id = $1
    `,
    [discordUserId]
  );

  return result.rows[0] || null;
}

function normalizeEntitlementStatus(value) {
  return String(value || "none").trim().toUpperCase();
}

function buildEntitlementRecord({
  owner = false,
  manual = false,
  tester = false,
  subscription = null,
} = {}) {
  if (owner) {
    return {
      tier: "pro",
      active: true,
      status: "OWNER",
      source: "owner",
      reason: "owner-access",
    };
  }

  if (manual) {
    return {
      tier: "pro",
      active: true,
      status: "MANUAL",
      source: "manual",
      reason: "manual-allow-list",
    };
  }

  if (tester) {
    return {
      tier: "pro",
      active: true,
      status: "TESTER",
      source: "tester",
      reason: "tester-access",
    };
  }

  const normalizedStatus = normalizeEntitlementStatus(subscription?.status);
  if (normalizedStatus === "ACTIVE" || Boolean(subscription?.active)) {
    return {
      tier: "pro",
      active: true,
      status: "ACTIVE",
      source: "billing",
      reason: "active-subscription",
      subscription_id: subscription?.subscription_id || null,
      plan_code: subscription?.plan_code || null,
      provider: subscription?.provider || null,
      current_period_end: subscription?.current_period_end || null,
    };
  }

  return {
    tier: "lite",
    active: false,
    status: normalizedStatus,
    source: normalizedStatus === "NONE" ? "none" : "billing",
    reason: normalizedStatus === "NONE" ? "not-pro" : "inactive-subscription",
    subscription_id: subscription?.subscription_id || null,
    plan_code: subscription?.plan_code || null,
    provider: subscription?.provider || null,
    current_period_end: subscription?.current_period_end || null,
  };
}

async function syncMemberWorkspaceState({
  discordUserId,
  username = null,
  avatarUrl = null,
  manageableGuilds = [],
} = {}) {
  await ensureUser(discordUserId, {
    username,
    avatar_url: avatarUrl,
  });

  const normalizedGuilds = Array.isArray(manageableGuilds)
    ? manageableGuilds
        .map((guild) => ({
          guild_id: String(guild?.guild_id || guild?.id || "").trim(),
          name: String(guild?.name || "").trim() || null,
          icon_url: String(guild?.icon_url || guild?.icon || "").trim() || null,
        }))
        .filter((guild) => guild.guild_id)
    : [];

  for (const guild of normalizedGuilds) {
    await ensureGuild(guild.guild_id, {
      name: guild.name,
      icon_url: guild.icon_url,
    });

    await query(
      `
        INSERT INTO guild_admin_access (
          guild_id,
          discord_user_id,
          access_source,
          can_manage_web_ui,
          last_confirmed_at,
          updated_at
        )
        VALUES ($1, $2, 'discord_oauth', TRUE, NOW(), NOW())
        ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
          access_source = EXCLUDED.access_source,
          can_manage_web_ui = TRUE,
          last_confirmed_at = NOW(),
          updated_at = NOW()
      `,
      [guild.guild_id, discordUserId]
    );
  }

  return {
    discord_user_id: discordUserId,
    guild_count: normalizedGuilds.length,
  };
}

async function getLatestSubscriptionForUser(discordUserId) {
  const result = await query(
    `
      SELECT *
      FROM subscriptions
      WHERE discord_user_id = $1
      ORDER BY active DESC, updated_at DESC, created_at DESC
      LIMIT 1
    `,
    [discordUserId]
  );

  return result.rows[0] || null;
}

async function getBillingProBoundGuildId(discordUserId) {
  const uid = String(discordUserId || "").trim();
  if (!uid) return null;

  const result = await query(
    `
      SELECT TRIM(pe.bound_guild_id::text) AS bound_guild_id
      FROM subscriptions s
      LEFT JOIN pro_entitlements pe
        ON pe.subscription_id = s.subscription_id
       AND COALESCE(pe.status, 'inactive') = 'active'
      WHERE s.discord_user_id = $1 AND s.active = TRUE
      ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC
      LIMIT 1
    `,
    [uid]
  );

  const row = result.rows[0];
  const boundGuildId = row && row.bound_guild_id ? String(row.bound_guild_id).trim() : "";
  return boundGuildId ? boundGuildId : null;
}

async function bindBillingProGuild(discordUserId, guildId) {
  const uid = String(discordUserId || "").trim();
  const gid = String(guildId || "").trim();
  if (!uid || !gid) return null;

  const result = await query(
    `
      SELECT subscription_id, COALESCE(plan_code, 'pro') AS plan_code
      FROM subscriptions
      WHERE discord_user_id = $1 AND active = TRUE
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
    `,
    [uid]
  );

  const row = result.rows[0];
  if (!row) return null;

  try {
    const saved = await query(
      `
        INSERT INTO pro_entitlements (
          subscription_id,
          plan_code,
          status,
          bound_guild_id,
          bound_at,
          updated_at
        )
        VALUES ($1, COALESCE(TRIM($2), 'pro'), 'active', $3, NOW(), NOW())
        ON CONFLICT (subscription_id) DO UPDATE SET
          bound_guild_id = COALESCE(pro_entitlements.bound_guild_id, EXCLUDED.bound_guild_id),
          bound_at = COALESCE(pro_entitlements.bound_at, EXCLUDED.bound_at),
          updated_at = NOW(),
          status = COALESCE(EXCLUDED.status, pro_entitlements.status)
        RETURNING bound_guild_id
      `,
      [row.subscription_id, row.plan_code, gid]
    );
    return saved.rows[0] || null;
  } catch (error) {
    if (error.code === "23505") {
      const conflict = Object.assign(new Error("That Discord server is already bound to another Pro subscription."), {
        code: "PRO_GUILD_SLOT_TAKEN",
      });
      throw conflict;
    }
    throw error;
  }
}

async function assertOrBindBillingProGuild(discordUserId, guildId, entitlementOptions = {}) {
  const uid = String(discordUserId || "").trim();
  const gid = String(guildId || "").trim();
  if (!uid || !gid) return;

  const entitlement = await getMemberEntitlement(uid, entitlementOptions || {});
  if (!entitlement || !entitlement.active || String(entitlement.tier || "").toLowerCase() !== "pro") {
    return;
  }
  if (entitlement.source !== "billing") {
    return;
  }

  const access = await query(
    `
      SELECT 1 FROM guild_admin_access
      WHERE discord_user_id = $1 AND guild_id = $2 AND can_manage_web_ui = TRUE
    `,
    [uid, gid]
  );
  if (!access.rows.length) {
    throw Object.assign(new Error("Guild admin access required."), { code: "guild_forbidden" });
  }

  const bound = await getBillingProBoundGuildId(uid);
  if (bound && bound !== gid) {
    throw Object.assign(
      new Error(
        `Your Pro subscription is locked to server ${bound}. Manage that guild in the dashboard, or upgrade for additional servers.`,
      ),
      { code: "PRO_GUILD_LOCKED" },
    );
  }

  if (!bound) {
    await bindBillingProGuild(uid, gid);
  }
}

async function listGuildKeywordFilters(guildId) {
  await ensurePhaseOneWorkspaceSchema();
  const result = await query(
    `
      SELECT platform, keyword, created_at
      FROM guild_keyword_filters
      WHERE guild_id = $1
      ORDER BY platform, keyword
    `,
    [guildId]
  );
  return result.rows.map((row) => ({
    platform: String(row.platform || "all").toLowerCase(),
    keyword: String(row.keyword || "").trim(),
    created_at: row.created_at,
  }));
}

async function addGuildKeywordFilter(guildId, platformRaw, keywordRaw) {
  await ensurePhaseOneWorkspaceSchema();
  const platform = String(platformRaw || "all").trim().toLowerCase() || "all";
  const keyword = String(keywordRaw || "").trim().toLowerCase();
  if (!keyword) {
    throw new Error("keyword is required");
  }
  await query(
    `
      INSERT INTO guild_keyword_filters (guild_id, platform, keyword)
      VALUES ($1, $2, $3)
      ON CONFLICT (guild_id, platform, keyword) DO NOTHING
    `,
    [guildId, platform, keyword]
  );
}

async function removeGuildKeywordFilter(guildId, platformRaw, keywordRaw) {
  await ensurePhaseOneWorkspaceSchema();
  const platform = String(platformRaw || "all").trim().toLowerCase() || "all";
  const keyword = String(keywordRaw || "").trim().toLowerCase();
  if (!keyword) {
    throw new Error("keyword is required");
  }
  await query(
    `
      DELETE FROM guild_keyword_filters
      WHERE guild_id = $1 AND platform = $2 AND keyword = $3
    `,
    [guildId, platform, keyword]
  );
}

async function getMemberEntitlement(discordUserId, options = {}) {
  const ownerSet = new Set(Array.isArray(options.ownerProUsers) ? options.ownerProUsers : []);
  const manualSet = new Set(Array.isArray(options.manualProUsers) ? options.manualProUsers : []);
  const testerSet = new Set(Array.isArray(options.testerProUsers) ? options.testerProUsers : []);
  const uid = String(discordUserId || "").trim();
  const subscription = uid ? await getLatestSubscriptionForUser(uid) : null;

  return buildEntitlementRecord({
    owner: ownerSet.has(uid),
    manual: manualSet.has(uid),
    tester: testerSet.has(uid),
    subscription,
  });
}

async function getMemberGuilds(discordUserId, options = {}) {
  const result = await query(
    `
      SELECT
        g.guild_id,
        g.name,
        g.icon_url,
        a.access_source,
        a.can_manage_web_ui,
        a.last_confirmed_at
      FROM guild_admin_access a
      INNER JOIN guilds g
        ON g.guild_id = a.guild_id
      WHERE a.discord_user_id = $1
        AND a.can_manage_web_ui = TRUE
      ORDER BY COALESCE(g.name, g.guild_id)
    `,
    [discordUserId]
  );

  const rows = result.rows || [];
  if (options.skipBillingGuildFilter) {
    return rows;
  }

  const entitlementOptions =
    typeof options.entitlementOptions === "object" && options.entitlementOptions !== null
      ? options.entitlementOptions
      : {};
  const entitlement =
    options.entitlement || (await getMemberEntitlement(discordUserId, entitlementOptions));

  if (!entitlement || !entitlement.active || String(entitlement.tier || "").toLowerCase() !== "pro") {
    return rows;
  }
  if (entitlement.source !== "billing") {
    return rows;
  }

  const bound = await getBillingProBoundGuildId(discordUserId);
  if (!bound) {
    return rows;
  }
  return rows.filter((row) => String(row.guild_id) === String(bound));
}

async function getGuildCreatorPerformance(guildId, days = 7) {
  await ensurePhaseOneWorkspaceSchema();

  const windowDays = Math.max(1, Number(days || 7));
  const [summaryResult, topCreatorsResult] = await Promise.all([
    query(
      `
        SELECT
          COUNT(*)::int AS alert_count,
          COUNT(DISTINCT discord_user_id)::int AS creator_count,
          MAX(posted_at) AS last_live_at
        FROM creator_live_alerts
        WHERE guild_id = $1
          AND posted_at >= NOW() - ($2::int * INTERVAL '1 day')
      `,
      [guildId, windowDays]
    ),
    query(
      `
        SELECT
          cp.discord_user_id,
          COALESCE(NULLIF(cp.display_name, ''), cp.discord_user_id) AS creator_name,
          COUNT(cla.*)::int AS alert_count,
          MAX(cla.posted_at) AS last_live_at,
          MAX(COALESCE(cla.viewer_count, 0))::int AS peak_viewers,
          STRING_AGG(DISTINCT cla.platform, ', ' ORDER BY cla.platform) AS platforms
        FROM creator_profiles cp
        LEFT JOIN creator_access ca
          ON ca.guild_id = cp.guild_id
         AND ca.discord_user_id = cp.discord_user_id
        LEFT JOIN creator_live_alerts cla
          ON cla.guild_id = cp.guild_id
         AND cla.discord_user_id = cp.discord_user_id
         AND cla.posted_at >= NOW() - ($2::int * INTERVAL '1 day')
        WHERE cp.guild_id = $1
          AND COALESCE(ca.status, 'pending') = 'approved'
        GROUP BY cp.guild_id, cp.discord_user_id, cp.display_name
        ORDER BY alert_count DESC, last_live_at DESC NULLS LAST, creator_name ASC
        LIMIT 5
      `,
      [guildId, windowDays]
    ),
  ]);

  const summaryRow = summaryResult.rows[0] || {};
  return {
    window_days: windowDays,
    summary: {
      alert_count: Number(summaryRow.alert_count || 0),
      creator_count: Number(summaryRow.creator_count || 0),
      last_live_at: summaryRow.last_live_at || null,
    },
    top_creators: topCreatorsResult.rows.map((row) => ({
      discord_user_id: row.discord_user_id,
      creator_name: row.creator_name,
      alert_count: Number(row.alert_count || 0),
      last_live_at: row.last_live_at || null,
      peak_viewers: Number(row.peak_viewers || 0),
      platforms: String(row.platforms || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    })),
  };
}

async function getGuildWorkspaceSnapshot(discordUserId, guildId) {
  await ensurePhaseOneWorkspaceSchema();

  const [guildConfig, creators, creatorIdentity, creatorConnections, templates, creatorPerformance, keywordFilters] =
    await Promise.all([
      getGuildConfig(guildId),
      getCreatorProfiles(guildId),
      getCreatorIdentity(discordUserId),
      getCreatorSocialConnections(discordUserId),
      getCreatorPostTemplates(discordUserId),
      getGuildCreatorPerformance(guildId),
      listGuildKeywordFilters(guildId),
    ]);

  return {
    guild_id: guildId,
    config: guildConfig,
    branding: guildConfig
      ? {
          brand_name: guildConfig.brand_name || null,
          brand_logo_url: guildConfig.brand_logo_url || null,
          preview_image_url: guildConfig.preview_image_url || null,
          footer_text: guildConfig.footer_text || null,
        }
      : null,
    live_automation: guildConfig
      ? {
          announce_channel_id: guildConfig.announce_channel_id || null,
          live_channel_id: guildConfig.live_channel_id || null,
          socials_feed_channel_id: guildConfig.socials_feed_channel_id || null,
          live_role_id: guildConfig.live_role_id || null,
          auto_cleanup: Boolean(guildConfig.auto_cleanup),
          cooldown_seconds: Number(guildConfig.cooldown_seconds || 0),
          mention_mode: guildConfig.mention_mode || "role",
          live_filter_games_json: Array.isArray(guildConfig.live_filter_games_json)
            ? guildConfig.live_filter_games_json
            : [],
          live_filter_languages_json: Array.isArray(guildConfig.live_filter_languages_json)
            ? guildConfig.live_filter_languages_json
            : [],
          live_filter_min_viewers: guildConfig.live_filter_min_viewers ?? null,
          live_filter_max_viewers: guildConfig.live_filter_max_viewers ?? null,
          category_role_routes_json: Array.isArray(guildConfig.category_role_routes_json)
            ? guildConfig.category_role_routes_json
            : [],
          auto_start_thread: Boolean(guildConfig.auto_start_thread),
          auto_start_thread_name: guildConfig.auto_start_thread_name || null,
          stream_end_message_enabled: Boolean(guildConfig.stream_end_message_enabled),
          stream_end_message_template: guildConfig.stream_end_message_template || null,
        }
      : null,
    creators,
    creator_count: creators.length,
    creator_performance: creatorPerformance,
    member_creator_state: {
      identity: creatorIdentity,
      connections: creatorConnections,
      templates,
      scheduled_posts: [],
    },
    keyword_filters: keywordFilters,
  };
}

async function syncPlatformSubscription({
  guildId = null,
  creatorGuildId = null,
  creatorDiscordUserId = null,
  platform,
  topicKey,
  callbackUrl = null,
  metadataJson = {},
}) {
  if (!platform) {
    throw new Error("Platform is required for a subscription sync.");
  }

  if (guildId) {
    await ensureGuild(guildId);
  }

  if (creatorGuildId) {
    await ensureGuild(creatorGuildId);
  }

  if (creatorDiscordUserId) {
    await ensureUser(creatorDiscordUserId);
  }

  await query(
    `
      UPDATE platform_subscriptions
      SET
        status = 'disabled',
        updated_at = NOW()
      WHERE platform = $1
        AND guild_id IS NOT DISTINCT FROM $2
        AND creator_guild_id IS NOT DISTINCT FROM $3
        AND creator_discord_user_id IS NOT DISTINCT FROM $4
    `,
    [
      platform,
      guildId,
      creatorGuildId,
      creatorDiscordUserId,
    ]
  );

  if (!topicKey) {
    return null;
  }

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
        metadata_json,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'active', $7::jsonb, NOW())
      ON CONFLICT (
        platform,
        topic_key,
        guild_id,
        creator_guild_id,
        creator_discord_user_id
      ) DO UPDATE SET
        callback_url = COALESCE(EXCLUDED.callback_url, platform_subscriptions.callback_url),
        status = 'active',
        metadata_json = platform_subscriptions.metadata_json || EXCLUDED.metadata_json,
        updated_at = NOW()
      RETURNING *
    `,
    [
      guildId,
      creatorGuildId,
      creatorDiscordUserId,
      platform,
      topicKey,
      callbackUrl,
      JSON.stringify(metadataJson || {}),
    ]
  );

  return result.rows[0] || null;
}

async function syncGuildPlatformSubscriptions(guildId, config = {}) {
  await ensureGuild(guildId);

  const platforms = [
    {
      platform: "twitch",
      topicKey: buildPlatformTopicKey({
        platform: "twitch",
        externalId: config.guild_twitch_external_id,
        url: config.guild_twitch_url,
      }),
      sourceUrl: config.guild_twitch_url,
    },
    {
      platform: "youtube",
      topicKey: buildPlatformTopicKey({
        platform: "youtube",
        externalId: config.guild_youtube_external_id,
        url: config.guild_youtube_url,
      }),
      sourceUrl: config.guild_youtube_url,
    },
    {
      platform: "kick",
      topicKey: buildPlatformTopicKey({
        platform: "kick",
        externalId: config.guild_kick_external_id,
        slug: config.guild_kick_slug,
        url: config.guild_kick_url,
      }),
      sourceUrl: config.guild_kick_url,
    },
  ];

  const results = [];
  for (const item of platforms) {
    const subscription = await syncPlatformSubscription({
      guildId,
      platform: item.platform,
      topicKey: item.topicKey,
      metadataJson: {
        sourceUrl: item.sourceUrl || null,
        scope: "guild",
      },
    });
    if (subscription) {
      results.push(subscription);
    }
  }

  return results;
}

async function syncCreatorPlatformSubscriptions(guildId, discordUserId, profile = {}) {
  await ensureGuild(guildId);
  await ensureUser(discordUserId);

  const platforms = [
    {
      platform: "twitch",
      topicKey: buildPlatformTopicKey({
        platform: "twitch",
        externalId: profile.twitch_external_id,
        url: profile.twitch_url,
      }),
      sourceUrl: profile.twitch_url,
    },
    {
      platform: "youtube",
      topicKey: buildPlatformTopicKey({
        platform: "youtube",
        externalId: profile.youtube_external_id,
        url: profile.youtube_url,
      }),
      sourceUrl: profile.youtube_url,
    },
    {
      platform: "kick",
      topicKey: buildPlatformTopicKey({
        platform: "kick",
        externalId: profile.kick_external_id,
        slug: profile.kick_slug,
        url: profile.kick_url,
      }),
      sourceUrl: profile.kick_url,
    },
  ];

  const results = [];
  for (const item of platforms) {
    const subscription = await syncPlatformSubscription({
      creatorGuildId: guildId,
      creatorDiscordUserId: discordUserId,
      platform: item.platform,
      topicKey: item.topicKey,
      metadataJson: {
        sourceUrl: item.sourceUrl || null,
        scope: "creator",
      },
    });
    if (subscription) {
      results.push(subscription);
    }
  }

  return results;
}

async function syncLitePlatformSubscriptions(guildId) {
  await ensureGuild(guildId);

  const result = await withTransaction(async (client) => {
    const creatorsResult = await client.query(
      `
        SELECT
          lite_creator_id,
          guild_id,
          platform,
          display_name,
          url,
          external_id,
          added_by_discord_user_id
        FROM lite_creators
        WHERE guild_id = $1
        ORDER BY created_at ASC, lite_creator_id ASC
      `,
      [guildId]
    );

    const creators = creatorsResult.rows;
    const rowsByPlatform = new Map();

    for (const creator of creators) {
      const platform = String(creator.platform || "").trim().toLowerCase();
      if (!platform) {
        continue;
      }

      const topicKey = buildPlatformTopicKey({
        platform,
        externalId: creator.external_id,
        url: creator.url,
      });

      if (!topicKey) {
        continue;
      }

      if (!rowsByPlatform.has(platform)) {
        rowsByPlatform.set(platform, []);
      }

      rowsByPlatform.get(platform).push({
        creator,
        topicKey,
      });
    }

    for (const platform of ["twitch", "youtube"]) {
      const activeRows = rowsByPlatform.get(platform) || [];
      const uniqueRowsByTopicKey = new Map();

      for (const row of activeRows) {
        if (!uniqueRowsByTopicKey.has(row.topicKey)) {
          uniqueRowsByTopicKey.set(row.topicKey, row);
        }
      }

      const uniqueActiveRows = Array.from(uniqueRowsByTopicKey.values());

      if (uniqueActiveRows.length) {
        await client.query(
          `
            UPDATE platform_subscriptions
            SET
              status = 'disabled',
              updated_at = NOW()
            WHERE platform = $1
              AND guild_id = $2
              AND creator_guild_id IS NULL
              AND creator_discord_user_id IS NULL
              AND COALESCE(metadata_json->>'scope', '') = 'lite'
              AND topic_key <> ALL($3::text[])
          `,
          [platform, guildId, uniqueActiveRows.map((row) => row.topicKey)]
        );
      } else {
        await client.query(
          `
            UPDATE platform_subscriptions
            SET
              status = 'disabled',
              updated_at = NOW()
            WHERE platform = $1
              AND guild_id = $2
              AND creator_guild_id IS NULL
              AND creator_discord_user_id IS NULL
              AND COALESCE(metadata_json->>'scope', '') = 'lite'
          `,
          [platform, guildId]
        );
      }

      for (const row of uniqueActiveRows) {
        const metadataJson = {
          sourceUrl: row.creator.url || null,
          scope: "lite",
          liteCreatorId: row.creator.lite_creator_id,
          displayName: row.creator.display_name || null,
          addedByDiscordUserId: row.creator.added_by_discord_user_id || null,
        };

        await client.query(
          `
            INSERT INTO platform_subscriptions (
              guild_id,
              creator_guild_id,
              creator_discord_user_id,
              platform,
              topic_key,
              callback_url,
              status,
              metadata_json,
              updated_at
            )
            VALUES ($1, NULL, NULL, $2, $3, NULL, 'active', $4::jsonb, NOW())
            ON CONFLICT (
              platform,
              topic_key,
              guild_id,
              creator_guild_id,
              creator_discord_user_id
            ) DO UPDATE SET
              status = 'active',
              metadata_json = platform_subscriptions.metadata_json || EXCLUDED.metadata_json,
              updated_at = NOW()
            RETURNING *
          `,
          [
            guildId,
            platform,
            row.topicKey,
            JSON.stringify(metadataJson),
          ]
        );
      }
    }

    const subscriptionsResult = await client.query(
      `
        SELECT *
        FROM platform_subscriptions
        WHERE guild_id = $1
          AND creator_guild_id IS NULL
          AND creator_discord_user_id IS NULL
          AND COALESCE(metadata_json->>'scope', '') = 'lite'
          AND status = 'active'
        ORDER BY platform, topic_key, subscription_id
      `,
      [guildId]
    );

    return subscriptionsResult.rows;
  });

  return result;
}

async function ingestPlatformEvent(event = {}) {
  const dedupeKey = event.dedupe_key || buildEventDedupeKey({
    platform: event.platform,
    eventType: event.event_type,
    sourceKey: event.source_key,
    sourceExternalId: event.source_external_id,
    sourceCreatedAt: event.source_created_at,
    providerEventId: event.provider_event_id,
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
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, COALESCE($8, 'received'))
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL
      DO UPDATE SET
        payload_json = EXCLUDED.payload_json,
        source_created_at = COALESCE(EXCLUDED.source_created_at, event_ingest.source_created_at)
      RETURNING *
    `,
    [
      event.platform,
      event.event_type,
      event.source_key,
      event.source_external_id || null,
      event.source_created_at || null,
      JSON.stringify(event.payload_json || {}),
      dedupeKey,
      event.processing_state || null,
    ]
  );

  return result.rows[0] || null;
}

async function getQueueStats(options = {}) {
  await ensureWorkerHeartbeatSchema();

  const thresholds = {
    lockTimeoutSeconds: Number(options.lockTimeoutSeconds || 120),
    backlogWarningSeconds: Number(options.backlogWarningSeconds || 300),
    leaseWarningSeconds: Number(options.leaseWarningSeconds || 3600),
    workerHeartbeatWarningSeconds: Number(options.workerHeartbeatWarningSeconds || 90),
    workerRssWarningBytes: Number(options.workerRssWarningBytes || 0),
    workerHeapWarningBytes: Number(options.workerHeapWarningBytes || 0),
    workerRestartStormWindowSeconds: Number(
      options.workerRestartStormWindowSeconds ?? 900
    ),
    workerRestartStormMinCount: Number(options.workerRestartStormMinCount ?? 3),
    pagerDeliveryFailWindowSeconds: Number(
      options.pagerDeliveryFailWindowSeconds ?? 3600
    ),
    pagerDeliveryFailMinCount: Number(options.pagerDeliveryFailMinCount ?? 3),
  };

  const pagerFailQuery =
    thresholds.pagerDeliveryFailWindowSeconds > 0
      ? query(
          `
            SELECT COUNT(*)::int AS failed_deliveries
            FROM ops_pager_deliveries
            WHERE status = 'failed'
              AND created_at > NOW() - make_interval(secs => $1)
          `,
          [thresholds.pagerDeliveryFailWindowSeconds]
        )
      : Promise.resolve({ rows: [{ failed_deliveries: 0 }] });

  const [
    jobs,
    ingest,
    subscriptions,
    jobSummary,
    ingestSummary,
    subscriptionSummary,
    recentFailedJobs,
    riskySubscriptions,
    socialJobSummary,
    socialIngestSummary,
    socialPostSummary,
    workerSummary,
    recentWorkers,
    pagerFailSummary,
  ] = await Promise.all([
    query(
      `
        SELECT
          queue_name,
          status,
          COUNT(*)::int AS count,
          MIN(available_at) AS oldest_available_at,
          MAX(attempts)::int AS max_attempts,
          COUNT(*) FILTER (WHERE last_error IS NOT NULL)::int AS error_count
        FROM job_queue
        GROUP BY queue_name, status
        ORDER BY queue_name, status
      `
    ),
    query(
      `
        SELECT
          platform,
          processing_state,
          COUNT(*)::int AS count,
          MIN(received_at) AS oldest_received_at
        FROM event_ingest
        GROUP BY platform, processing_state
        ORDER BY platform, processing_state
      `
    ),
    query(
      `
        SELECT
          platform,
          status,
          COUNT(*)::int AS count,
          MIN(lease_expires_at) AS next_lease_expiry
        FROM platform_subscriptions
        GROUP BY platform, status
        ORDER BY platform, status
      `
    ),
    query(
      `
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending' AND available_at <= NOW())::int AS ready_jobs,
          COUNT(*) FILTER (WHERE status = 'processing')::int AS processing_jobs,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_jobs,
          COUNT(*) FILTER (
            WHERE status = 'processing'
              AND locked_at IS NOT NULL
              AND locked_at < NOW() - make_interval(secs => $1)
          )::int AS stale_locks,
          MIN(available_at) FILTER (WHERE status = 'pending' AND available_at <= NOW()) AS oldest_ready_job_at
        FROM job_queue
      `,
      [thresholds.lockTimeoutSeconds]
    ),
    query(
      `
        SELECT
          COUNT(*) FILTER (WHERE processing_state IN ('received', 'queued', 'processing'))::int AS backlog_events,
          MIN(received_at) FILTER (WHERE processing_state IN ('received', 'queued', 'processing')) AS oldest_backlog_event_at
        FROM event_ingest
      `
    ),
    query(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE status = 'active'
              AND lease_expires_at IS NOT NULL
              AND lease_expires_at < NOW()
          )::int AS expired_subscriptions,
          COUNT(*) FILTER (
            WHERE status = 'active'
              AND lease_expires_at IS NOT NULL
              AND lease_expires_at >= NOW()
              AND lease_expires_at < NOW() + make_interval(secs => $1)
          )::int AS due_soon_subscriptions,
          COUNT(*) FILTER (WHERE status = 'revoked')::int AS revoked_subscriptions
        FROM platform_subscriptions
      `,
      [thresholds.leaseWarningSeconds]
    ),
    query(
      `
        SELECT
          job_id,
          queue_name,
          job_type,
          attempts,
          max_attempts,
          last_error,
          updated_at
        FROM job_queue
        WHERE status = 'failed'
        ORDER BY updated_at DESC, job_id DESC
        LIMIT 20
      `
    ),
    query(
      `
        SELECT
          subscription_id,
          platform,
          topic_key,
          status,
          lease_expires_at,
          updated_at
        FROM platform_subscriptions
        WHERE status = 'revoked'
           OR (
             status = 'active'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at < NOW() + make_interval(secs => $1)
           )
        ORDER BY lease_expires_at NULLS FIRST, updated_at DESC
        LIMIT 20
      `,
      [thresholds.leaseWarningSeconds]
    ),
    query(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE queue_name = 'social_feed'
              AND status = 'pending'
              AND available_at <= NOW()
          )::int AS ready_jobs,
          COUNT(*) FILTER (
            WHERE queue_name = 'social_feed'
              AND status = 'processing'
          )::int AS processing_jobs,
          COUNT(*) FILTER (
            WHERE queue_name = 'social_feed'
              AND status = 'failed'
          )::int AS failed_jobs,
          MIN(available_at) FILTER (
            WHERE queue_name = 'social_feed'
              AND status = 'pending'
              AND available_at <= NOW()
          ) AS oldest_ready_job_at
        FROM job_queue
      `
    ),
    query(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE event_type = 'social.post.created'
              AND processing_state IN ('received', 'queued', 'processing')
          )::int AS backlog_events,
          COUNT(*) FILTER (
            WHERE event_type = 'social.post.created'
              AND processing_state = 'failed'
          )::int AS failed_events,
          MIN(received_at) FILTER (
            WHERE event_type = 'social.post.created'
              AND processing_state IN ('received', 'queued', 'processing')
          ) AS oldest_backlog_event_at
        FROM event_ingest
      `
    ),
    query(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE session_key LIKE 'social:%'
              AND status = 'posting'
          )::int AS posting_posts,
          COUNT(*) FILTER (
            WHERE session_key LIKE 'social:%'
              AND status = 'posted'
          )::int AS posted_posts,
          COUNT(*) FILTER (
            WHERE session_key LIKE 'social:%'
              AND status = 'failed'
          )::int AS failed_posts
        FROM post_history
      `
    ),
    query(
      `
        WITH recent_worker_starts AS (
          SELECT
            start_events.worker_name,
            COUNT(*)::int AS recent_start_count
          FROM worker_start_events start_events
          INNER JOIN worker_heartbeats heartbeats
            ON heartbeats.worker_name = start_events.worker_name
          WHERE $2::double precision > 0
            AND heartbeats.status = 'running'
            AND start_events.started_at >= NOW() - make_interval(secs => $2)
          GROUP BY start_events.worker_name
        )
        SELECT
          COUNT(*)::int AS total_workers,
          COUNT(*) FILTER (WHERE status = 'running')::int AS running_workers,
          COUNT(*) FILTER (WHERE status = 'stopped')::int AS stopped_workers,
          COUNT(*) FILTER (
            WHERE status = 'running'
              AND last_seen_at < NOW() - make_interval(secs => $1)
          )::int AS stale_running_workers,
          COALESCE((
            SELECT SUM(recent_start_count)
            FROM recent_worker_starts
          ), 0)::int AS recent_running_starts,
          MAX(last_seen_at) AS latest_seen_at,
          MIN(last_seen_at) FILTER (
            WHERE status = 'running'
              AND last_seen_at < NOW() - make_interval(secs => $1)
          ) AS oldest_stale_seen_at,
          MAX(rss_bytes)::bigint AS max_rss_bytes,
          MAX(heap_used_bytes)::bigint AS max_heap_used_bytes,
          MAX(max_rss_bytes)::bigint AS peak_rss_bytes,
          MAX(max_heap_used_bytes)::bigint AS peak_heap_used_bytes
        FROM worker_heartbeats
      `,
      [thresholds.workerHeartbeatWarningSeconds, thresholds.workerRestartStormWindowSeconds]
    ),
    query(
      `
        SELECT
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
          max_rss_bytes,
          max_heap_used_bytes,
          updated_at
        FROM worker_heartbeats
        ORDER BY
          CASE WHEN status = 'running' THEN 0 ELSE 1 END,
          last_seen_at DESC,
          worker_name ASC
        LIMIT 20
      `
    ),
    pagerFailQuery,
  ]);

  const jobSummaryRow = jobSummary.rows[0] || {};
  const ingestSummaryRow = ingestSummary.rows[0] || {};
  const subscriptionSummaryRow = subscriptionSummary.rows[0] || {};
  const socialJobSummaryRow = socialJobSummary.rows[0] || {};
  const socialIngestSummaryRow = socialIngestSummary.rows[0] || {};
  const socialPostSummaryRow = socialPostSummary.rows[0] || {};
  const workerSummaryRow = workerSummary.rows[0] || {};
  const pagerFailRow = pagerFailSummary.rows[0] || {};

  const summary = {
    jobs: {
      ready: Number(jobSummaryRow.ready_jobs || 0),
      processing: Number(jobSummaryRow.processing_jobs || 0),
      failed: Number(jobSummaryRow.failed_jobs || 0),
      staleLocks: Number(jobSummaryRow.stale_locks || 0),
      oldestReadyJobAt: jobSummaryRow.oldest_ready_job_at || null,
      oldestReadyAgeSeconds: ageSeconds(jobSummaryRow.oldest_ready_job_at),
    },
    ingest: {
      backlog: Number(ingestSummaryRow.backlog_events || 0),
      oldestBacklogEventAt: ingestSummaryRow.oldest_backlog_event_at || null,
      oldestBacklogAgeSeconds: ageSeconds(ingestSummaryRow.oldest_backlog_event_at),
    },
    subscriptions: {
      expired: Number(subscriptionSummaryRow.expired_subscriptions || 0),
      dueSoon: Number(subscriptionSummaryRow.due_soon_subscriptions || 0),
      revoked: Number(subscriptionSummaryRow.revoked_subscriptions || 0),
    },
    socialFeed: buildSocialFeedOpsSummary(
      socialJobSummaryRow,
      socialIngestSummaryRow,
      socialPostSummaryRow
    ),
    workers: buildWorkerOpsSummary(workerSummaryRow),
    pager: {
      failedDeliveriesInWindow: Number(pagerFailRow.failed_deliveries || 0),
    },
  };

  return {
    checkedAt: new Date().toISOString(),
    summary,
    warnings: buildOpsWarnings(summary, thresholds),
    queueBreakdown: buildQueueBreakdown(jobs.rows),
    jobs: jobs.rows,
    ingest: ingest.rows,
    subscriptions: subscriptions.rows,
    recentFailedJobs: recentFailedJobs.rows,
    riskySubscriptions: riskySubscriptions.rows,
    recentWorkers: recentWorkers.rows,
  };
}

async function getGuildConfig(guildId) {
  await ensurePhaseOneWorkspaceSchema();

  const result = await query(
    `
      SELECT *
      FROM guild_config
      WHERE guild_id = $1
    `,
    [guildId]
  );

  return result.rows[0] || null;
}

async function upsertGuildConfig(guildId, patch) {
  await ensurePhaseOneWorkspaceSchema();
  await ensureGuild(guildId);

  const result = await query(
    `
      INSERT INTO guild_config (
        guild_id,
        announce_channel_id,
        live_channel_id,
        socials_feed_channel_id,
        live_role_id,
        auto_cleanup,
        cooldown_seconds,
        mention_mode,
        brand_name,
        brand_logo_url,
        preview_image_url,
        footer_text,
        guild_twitch_url,
        guild_youtube_url,
        guild_kick_url,
        live_filter_games_json,
        live_filter_languages_json,
        live_filter_min_viewers,
        live_filter_max_viewers,
        category_role_routes_json,
        auto_start_thread,
        auto_start_thread_name,
        stream_end_message_enabled,
        stream_end_message_template,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15,
        $16::jsonb, $17::jsonb, $18, $19, $20::jsonb, $21, $22, $23, $24,
        NOW()
      )
      ON CONFLICT (guild_id) DO UPDATE SET
        announce_channel_id = EXCLUDED.announce_channel_id,
        live_channel_id = EXCLUDED.live_channel_id,
        socials_feed_channel_id = EXCLUDED.socials_feed_channel_id,
        live_role_id = EXCLUDED.live_role_id,
        auto_cleanup = EXCLUDED.auto_cleanup,
        cooldown_seconds = EXCLUDED.cooldown_seconds,
        mention_mode = EXCLUDED.mention_mode,
        brand_name = EXCLUDED.brand_name,
        brand_logo_url = EXCLUDED.brand_logo_url,
        preview_image_url = EXCLUDED.preview_image_url,
        footer_text = EXCLUDED.footer_text,
        guild_twitch_url = EXCLUDED.guild_twitch_url,
        guild_youtube_url = EXCLUDED.guild_youtube_url,
        guild_kick_url = EXCLUDED.guild_kick_url,
        live_filter_games_json = EXCLUDED.live_filter_games_json,
        live_filter_languages_json = EXCLUDED.live_filter_languages_json,
        live_filter_min_viewers = EXCLUDED.live_filter_min_viewers,
        live_filter_max_viewers = EXCLUDED.live_filter_max_viewers,
        category_role_routes_json = EXCLUDED.category_role_routes_json,
        auto_start_thread = EXCLUDED.auto_start_thread,
        auto_start_thread_name = EXCLUDED.auto_start_thread_name,
        stream_end_message_enabled = EXCLUDED.stream_end_message_enabled,
        stream_end_message_template = EXCLUDED.stream_end_message_template,
        updated_at = NOW()
      RETURNING *
    `,
    [
      guildId,
      patch.announce_channel_id,
      patch.live_channel_id,
      patch.socials_feed_channel_id,
      patch.live_role_id,
      patch.auto_cleanup,
      patch.cooldown_seconds,
      patch.mention_mode,
      patch.brand_name,
      patch.brand_logo_url,
      patch.preview_image_url,
      patch.footer_text,
      patch.guild_twitch_url,
      patch.guild_youtube_url,
      patch.guild_kick_url,
      JSON.stringify(Array.isArray(patch.live_filter_games_json) ? patch.live_filter_games_json : []),
      JSON.stringify(Array.isArray(patch.live_filter_languages_json) ? patch.live_filter_languages_json : []),
      patch.live_filter_min_viewers,
      patch.live_filter_max_viewers,
      JSON.stringify(Array.isArray(patch.category_role_routes_json) ? patch.category_role_routes_json : []),
      Boolean(patch.auto_start_thread),
      patch.auto_start_thread_name || null,
      Boolean(patch.stream_end_message_enabled),
      patch.stream_end_message_template || null,
    ]
  );

  return result.rows[0];
}

async function getCreatorProfiles(guildId) {
  const result = await query(
    `
      SELECT
        p.*,
        COALESCE(a.status, 'pending') AS access_status,
        a.approved_by,
        a.approved_at
      FROM creator_profiles p
      LEFT JOIN creator_access a
        ON a.guild_id = p.guild_id
       AND a.discord_user_id = p.discord_user_id
      WHERE p.guild_id = $1
      ORDER BY COALESCE(NULLIF(p.display_name, ''), p.discord_user_id)
    `,
    [guildId]
  );

  return result.rows;
}

async function saveCreatorProfile(guildId, discordUserId, patch) {
  await ensureGuild(guildId);
  await ensureUser(discordUserId);

  return withTransaction(async (client) => {
    const profileResult = await client.query(
      `
        INSERT INTO creator_profiles (
          guild_id,
          discord_user_id,
          display_name,
          twitch_url,
          twitch_external_id,
          youtube_url,
          youtube_external_id,
          kick_url,
          kick_external_id,
          kick_slug,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          NOW()
        )
        ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          twitch_url = EXCLUDED.twitch_url,
          twitch_external_id = EXCLUDED.twitch_external_id,
          youtube_url = EXCLUDED.youtube_url,
          youtube_external_id = EXCLUDED.youtube_external_id,
          kick_url = EXCLUDED.kick_url,
          kick_external_id = EXCLUDED.kick_external_id,
          kick_slug = EXCLUDED.kick_slug,
          updated_at = NOW()
        RETURNING *
      `,
      [
        guildId,
        discordUserId,
        patch.display_name,
        patch.twitch_url,
        patch.twitch_external_id,
        patch.youtube_url,
        patch.youtube_external_id,
        patch.kick_url,
        patch.kick_external_id,
        patch.kick_slug,
      ]
    );

    await client.query(
      `
        INSERT INTO creator_access (
          guild_id,
          discord_user_id,
          status,
          updated_at
        )
        VALUES ($1, $2, 'pending', NOW())
        ON CONFLICT (guild_id, discord_user_id) DO NOTHING
      `,
      [guildId, discordUserId]
    );

    return profileResult.rows[0];
  });
}

async function updateCreatorAccess(guildId, discordUserId, patch) {
  await ensureGuild(guildId);
  await ensureUser(discordUserId);

  const result = await query(
    `
      INSERT INTO creator_access (
        guild_id,
        discord_user_id,
        status,
        approved_by,
        approved_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
        status = EXCLUDED.status,
        approved_by = EXCLUDED.approved_by,
        approved_at = EXCLUDED.approved_at,
        updated_at = NOW()
      RETURNING *
    `,
    [
      guildId,
      discordUserId,
      patch.status,
      patch.approved_by,
      patch.approved_at,
    ]
  );

  return result.rows[0];
}

async function getCreatorIdentity(discordUserId) {
  const result = await query(
    `
      SELECT *
      FROM creator_identities
      WHERE discord_user_id = $1
    `,
    [discordUserId]
  );

  return result.rows[0] || null;
}

async function saveCreatorIdentity(discordUserId, patch = {}) {
  await ensureUser(discordUserId);

  const result = await query(
    `
      INSERT INTO creator_identities (
        discord_user_id,
        display_name,
        twitch_url,
        youtube_url,
        kick_url,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (discord_user_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        twitch_url = EXCLUDED.twitch_url,
        youtube_url = EXCLUDED.youtube_url,
        kick_url = EXCLUDED.kick_url,
        updated_at = NOW()
      RETURNING *
    `,
    [
      discordUserId,
      patch.display_name || null,
      patch.twitch_url || null,
      patch.youtube_url || null,
      patch.kick_url || null,
    ]
  );

  return result.rows[0] || null;
}

async function getCreatorSocialConnections(discordUserId) {
  const result = await query(
    `
      SELECT
        connection_id,
        discord_user_id,
        platform,
        external_account_id,
        external_account_name,
        token_expires_at,
        status,
        metadata_json,
        created_at,
        updated_at
      FROM creator_social_connections
      WHERE discord_user_id = $1
      ORDER BY platform
    `,
    [discordUserId]
  );

  return result.rows;
}

async function getCreatorSocialConnectionForOAuth(discordUserId, platform) {
  await ensurePhaseOneWorkspaceSchema();

  const result = await query(
    `
      SELECT *
      FROM creator_social_connections
      WHERE discord_user_id = $1
        AND platform = $2
      LIMIT 1
    `,
    [discordUserId, platform]
  );

  return result.rows[0] || null;
}

async function getActiveCreatorSocialPlatforms(discordUserId) {
  await ensurePhaseOneWorkspaceSchema();

  const result = await query(
    `
      SELECT platform
      FROM creator_social_connections
      WHERE discord_user_id = $1
        AND status = 'active'
        AND COALESCE(external_account_id, '') <> ''
      ORDER BY platform
    `,
    [discordUserId]
  );

  return result.rows.map((row) => row.platform);
}

async function getCreatorDispatchForUser(discordUserId, dispatchId) {
  await ensurePhaseOneWorkspaceSchema();
  const result = await query(
    `
      SELECT *
      FROM creator_post_dispatches
      WHERE discord_user_id = $1
        AND dispatch_id = $2
      LIMIT 1
    `,
    [discordUserId, dispatchId]
  );

  return result.rows[0] || null;
}

async function listScheduledCreatorDispatches(discordUserId, options = {}) {
  await ensurePhaseOneWorkspaceSchema();
  const limit = Math.max(1, Math.min(100, Number(options.limit || 50)));
  const includePast = Boolean(options.includePast);
  const timeFilter = includePast ? "" : "AND scheduled_at >= NOW() - INTERVAL '1 day'";

  const result = await query(
    `
      SELECT *
      FROM creator_post_dispatches
      WHERE discord_user_id = $1
        AND scheduled_at IS NOT NULL
        ${timeFilter}
      ORDER BY scheduled_at ASC, dispatch_id ASC
      LIMIT $2
    `,
    [discordUserId, limit]
  );

  return result.rows;
}

async function upsertCreatorSocialConnection(discordUserId, platform, patch = {}) {
  if (!CREATOR_SOCIAL_PLATFORMS.includes(platform)) {
    throw new Error(`Unsupported creator social platform: ${platform}`);
  }

  await ensureUser(discordUserId);

  const result = await query(
    `
      INSERT INTO creator_social_connections (
        discord_user_id,
        platform,
        external_account_id,
        external_account_name,
        access_token,
        refresh_token,
        token_expires_at,
        status,
        metadata_json,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
      ON CONFLICT (discord_user_id, platform) DO UPDATE SET
        external_account_id = EXCLUDED.external_account_id,
        external_account_name = EXCLUDED.external_account_name,
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        token_expires_at = EXCLUDED.token_expires_at,
        status = EXCLUDED.status,
        metadata_json = EXCLUDED.metadata_json,
        updated_at = NOW()
      RETURNING
        connection_id,
        discord_user_id,
        platform,
        external_account_id,
        external_account_name,
        token_expires_at,
        status,
        metadata_json,
        created_at,
        updated_at
    `,
    [
      discordUserId,
      platform,
      patch.external_account_id || null,
      patch.external_account_name || null,
      patch.access_token || null,
      patch.refresh_token || null,
      patch.token_expires_at || null,
      patch.status || "active",
      JSON.stringify(patch.metadata_json || {}),
    ]
  );

  return result.rows[0];
}

async function deleteCreatorSocialConnection(discordUserId, platform) {
  if (!CREATOR_SOCIAL_PLATFORMS.includes(platform)) {
    throw new Error(`Unsupported creator social platform: ${platform}`);
  }

  await ensurePhaseOneWorkspaceSchema();
  await ensureUser(discordUserId);

  await query(
    `
      DELETE FROM creator_social_connections
      WHERE discord_user_id = $1
        AND platform = $2
    `,
    [discordUserId, platform]
  );

  return { ok: true, platform };
}

async function getCreatorPostTemplates(discordUserId) {
  const result = await query(
    `
      SELECT *
      FROM creator_post_templates
      WHERE discord_user_id = $1
      ORDER BY is_default DESC, updated_at DESC, template_id DESC
    `,
    [discordUserId]
  );

  return result.rows;
}

async function saveCreatorPostTemplate(discordUserId, patch = {}) {
  await ensureUser(discordUserId);

  return withTransaction(async (client) => {
    if (patch.is_default) {
      await client.query(
        `
          UPDATE creator_post_templates
          SET is_default = FALSE, updated_at = NOW()
          WHERE discord_user_id = $1
        `,
        [discordUserId]
      );
    }

    const mediaUrls = Array.isArray(patch.media_urls_json) ? patch.media_urls_json : [];
    const targetPlatforms = Array.isArray(patch.target_platforms_json) ? patch.target_platforms_json : [];

    const values = [
      discordUserId,
      patch.name || "Quick post",
      patch.post_text || "",
      patch.link_url || null,
      JSON.stringify(mediaUrls),
      JSON.stringify(targetPlatforms),
      Boolean(patch.is_default),
    ];

    if (patch.template_id) {
      const updateResult = await client.query(
        `
          UPDATE creator_post_templates
          SET
            name = $3,
            post_text = $4,
            link_url = $5,
            media_urls_json = $6::jsonb,
            target_platforms_json = $7::jsonb,
            is_default = $8,
            updated_at = NOW()
          WHERE discord_user_id = $1
            AND template_id = $2
          RETURNING *
        `,
        [
          discordUserId,
          patch.template_id,
          values[1],
          values[2],
          values[3],
          values[4],
          values[5],
          values[6],
        ]
      );

      return updateResult.rows[0] || null;
    }

    const insertResult = await client.query(
      `
        INSERT INTO creator_post_templates (
          discord_user_id,
          name,
          post_text,
          link_url,
          media_urls_json,
          target_platforms_json,
          is_default,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, NOW())
        RETURNING *
      `,
      values
    );

    return insertResult.rows[0];
  });
}

async function createCreatorPostDispatch(discordUserId, patch = {}) {
  await ensureUser(discordUserId);
  await ensurePhaseOneWorkspaceSchema();

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

  return result.rows[0];
}

function summarizeConnectionHealth(connections = []) {
  return connections.map((connection) => ({
    platform: connection.platform,
    status: connection.status,
    external_account_id: connection.external_account_id,
    external_account_name: connection.external_account_name,
    connected: String(connection.status || "").toLowerCase() === "active" &&
      Boolean(String(connection.external_account_id || "").trim()),
  }));
}

async function getAutomationHome(discordUserId, options = {}) {
  await ensurePhaseOneWorkspaceSchema();
  const [
    activity,
    connections,
    scheduled,
    dispatchSummary,
    publicationSummary,
    topPlatform,
    liveRows,
    deviceSummary,
  ] = await Promise.all([
    listAutomationActivity(discordUserId, { limit: 8 }),
    getCreatorSocialConnections(discordUserId),
    listScheduledCreatorDispatches(discordUserId, { limit: 6 }),
    query(
      `
        SELECT
          COUNT(*) FILTER (WHERE created_at >= date_trunc('day', NOW()))::int AS posts_today,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('day', NOW()) AND status IN ('completed', 'partial', 'failed'))::int AS finished_today,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('day', NOW()) AND status IN ('completed', 'partial'))::int AS successful_today,
          COUNT(*) FILTER (WHERE status IN ('failed', 'partial'))::int AS needs_attention,
          COUNT(*) FILTER (WHERE status = 'scheduled' AND scheduled_at >= NOW())::int AS scheduled_count
        FROM creator_post_dispatches
        WHERE discord_user_id = $1
      `,
      [discordUserId]
    ),
    query(
      `
        SELECT
          COUNT(*) FILTER (WHERE updated_at >= date_trunc('day', NOW()))::int AS publication_updates_today,
          COUNT(*) FILTER (WHERE updated_at >= date_trunc('day', NOW()) AND status IN ('posted', 'recorded_placeholder'))::int AS posted_today,
          COUNT(*) FILTER (WHERE updated_at >= date_trunc('day', NOW()) AND status = 'failed')::int AS failed_today
        FROM social_post_publications
        WHERE discord_user_id = $1
      `,
      [discordUserId]
    ),
    query(
      `
        SELECT platform, COUNT(*)::int AS count
        FROM social_post_publications
        WHERE discord_user_id = $1
          AND updated_at >= NOW() - INTERVAL '7 days'
          AND status IN ('posted', 'recorded_placeholder')
        GROUP BY platform
        ORDER BY count DESC, platform ASC
        LIMIT 1
      `,
      [discordUserId]
    ),
    query(
      `
        SELECT DISTINCT ON (platform, session_key)
          platform,
          session_key,
          title,
          category_name,
          viewer_count,
          started_at,
          posted_at
        FROM creator_live_alerts
        WHERE discord_user_id = $1
          AND posted_at >= NOW() - INTERVAL '6 hours'
        ORDER BY platform, session_key, posted_at DESC
        LIMIT 10
      `,
      [discordUserId]
    ),
    query(
      `
        SELECT
          COUNT(*) FILTER (WHERE status = 'active')::int AS active_devices,
          MAX(last_seen_at) AS last_seen_at
        FROM mobile_push_devices
        WHERE discord_user_id = $1
      `,
      [discordUserId]
    ),
  ]);

  const dispatch = dispatchSummary.rows[0] || {};
  const publications = publicationSummary.rows[0] || {};
  const finishedToday = Number(dispatch.finished_today || 0);
  const successfulToday = Number(dispatch.successful_today || 0);
  const successRate = finishedToday > 0 ? Math.round((successfulToday / finishedToday) * 100) : null;
  const connectionHealth = summarizeConnectionHealth(connections);

  return {
    summary: {
      creators_live: liveRows.rows.length,
      posts_today: Number(dispatch.posts_today || 0),
      success_rate: successRate,
      top_platform: topPlatform.rows[0]?.platform || null,
      last_post_result: activity.items.find((item) => item.dispatch_id)?.event_type || null,
      scheduled_count: Number(dispatch.scheduled_count || 0),
      needs_attention: Number(dispatch.needs_attention || 0) + Number(publications.failed_today || 0),
    },
    health: {
      push_configured: Boolean(options.pushConfigured),
      active_push_devices: Number(deviceSummary.rows[0]?.active_devices || 0),
      last_push_device_seen_at: deviceSummary.rows[0]?.last_seen_at || null,
      connected_platforms: connectionHealth.filter((item) => item.connected).length,
      total_platforms: connectionHealth.length,
    },
    live_now: liveRows.rows,
    connected_platforms: connectionHealth,
    scheduled,
    recent_activity: activity.items,
  };
}

async function getCreatorPostBuilderState(discordUserId) {
  const [identity, connections, templates] = await Promise.all([
    getCreatorIdentity(discordUserId),
    getCreatorSocialConnections(discordUserId),
    getCreatorPostTemplates(discordUserId),
  ]);

  return {
    identity,
    connections,
    templates,
  };
}

module.exports = {
  addGuildKeywordFilter,
  assertOrBindBillingProGuild,
  buildQueueBreakdown,
  buildOpsWarnings,
  buildSocialFeedOpsSummary,
  buildEntitlementRecord,
  consumeSocialOAuthState,
  createSocialOAuthState,
  createCreatorPostDispatch,
  deleteCreatorSocialConnection,
  disableMobilePushDevice,
  ensurePhaseOneWorkspaceSchema,
  evaluateSocialOriginCandidate,
  ensureGuild,
  ensureUser,
  getActiveMobilePushDevices,
  getBillingProBoundGuildId,
  getCreatorIdentity,
  getAutomationHome,
  getCreatorDispatchForUser,
  getCreatorPostBuilderState,
  getActiveCreatorSocialPlatforms,
  getCreatorProfiles,
  getCreatorPostTemplates,
  getCreatorSocialConnectionForOAuth,
  getCreatorSocialConnections,
  getGuildCreatorPerformance,
  getGuildWorkspaceSnapshot,
  getGuildConfig,
  getLatestSubscriptionForUser,
  getMemberEntitlement,
  getMemberGuilds,
  getUser,
  getQueueStats,
  ingestPlatformEvent,
  listAutomationActivity,
  listGuildKeywordFilters,
  listScheduledCreatorDispatches,
  markAutomationActivityPushStatus,
  recordAutomationActivity,
  recordMobilePushDelivery,
  recordSocialOriginDecision,
  registerMobilePushDevice,
  removeGuildKeywordFilter,
  saveCreatorProfile,
  saveCreatorIdentity,
  saveCreatorPostTemplate,
  syncMemberWorkspaceState,
  syncCreatorPlatformSubscriptions,
  syncGuildPlatformSubscriptions,
  syncLitePlatformSubscriptions,
  syncPlatformSubscription,
  upsertCreatorSocialConnection,
  updateCreatorAccess,
  upsertGuildConfig,
};
