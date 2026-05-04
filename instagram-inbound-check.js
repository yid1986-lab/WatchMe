CREATE TABLE IF NOT EXISTS users (
  discord_user_id TEXT PRIMARY KEY,
  username TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guilds (
  guild_id TEXT PRIMARY KEY,
  name TEXT,
  icon_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  subscription_id TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL REFERENCES users(discord_user_id),
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  plan_code TEXT,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subscriptions_status_idx
  ON subscriptions (provider, status, active);

CREATE TABLE IF NOT EXISTS pro_entitlements (
  entitlement_id BIGSERIAL PRIMARY KEY,
  subscription_id TEXT UNIQUE REFERENCES subscriptions(subscription_id),
  plan_code TEXT NOT NULL DEFAULT 'pro',
  status TEXT NOT NULL DEFAULT 'active',
  bound_guild_id TEXT UNIQUE REFERENCES guilds(guild_id),
  install_token TEXT UNIQUE,
  installed_by_discord_user_id TEXT REFERENCES users(discord_user_id),
  bound_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pro_entitlements_status_bound_idx
  ON pro_entitlements (status, bound_guild_id);

CREATE TABLE IF NOT EXISTS guild_admin_access (
  guild_id TEXT NOT NULL REFERENCES guilds(guild_id),
  discord_user_id TEXT NOT NULL REFERENCES users(discord_user_id),
  access_source TEXT NOT NULL DEFAULT 'discord_permissions',
  can_manage_web_ui BOOLEAN NOT NULL DEFAULT TRUE,
  last_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, discord_user_id)
);

CREATE INDEX IF NOT EXISTS guild_admin_access_lookup_idx
  ON guild_admin_access (discord_user_id, guild_id);

CREATE TABLE IF NOT EXISTS creator_identities (
  discord_user_id TEXT PRIMARY KEY REFERENCES users(discord_user_id),
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  twitch_url TEXT,
  twitch_external_id TEXT,
  youtube_url TEXT,
  youtube_external_id TEXT,
  kick_url TEXT,
  kick_external_id TEXT,
  kick_slug TEXT,
  post_template TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS creator_social_connections (
  connection_id BIGSERIAL PRIMARY KEY,
  discord_user_id TEXT NOT NULL REFERENCES users(discord_user_id),
  platform TEXT NOT NULL,
  external_account_id TEXT,
  external_account_name TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (discord_user_id, platform)
);

CREATE INDEX IF NOT EXISTS creator_social_connections_status_idx
  ON creator_social_connections (platform, status, discord_user_id);

CREATE TABLE IF NOT EXISTS creator_post_templates (
  template_id BIGSERIAL PRIMARY KEY,
  discord_user_id TEXT NOT NULL REFERENCES users(discord_user_id),
  name TEXT NOT NULL,
  post_text TEXT NOT NULL DEFAULT '',
  link_url TEXT,
  media_urls_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_platforms_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS creator_post_templates_default_idx
  ON creator_post_templates (discord_user_id)
  WHERE is_default = TRUE;

CREATE TABLE IF NOT EXISTS creator_post_dispatches (
  dispatch_id BIGSERIAL PRIMARY KEY,
  discord_user_id TEXT NOT NULL REFERENCES users(discord_user_id),
  template_id BIGINT REFERENCES creator_post_templates(template_id),
  status TEXT NOT NULL DEFAULT 'queued',
  target_platforms_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS creator_post_dispatches_status_idx
  ON creator_post_dispatches (status, created_at);

CREATE TABLE IF NOT EXISTS social_post_publications (
  publication_id BIGSERIAL PRIMARY KEY,
  dispatch_id BIGINT NOT NULL REFERENCES creator_post_dispatches(dispatch_id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL REFERENCES users(discord_user_id),
  platform TEXT NOT NULL,
  connection_id BIGINT REFERENCES creator_social_connections(connection_id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  origin_key TEXT NOT NULL,
  origin_fingerprint TEXT,
  external_account_id TEXT,
  external_post_id TEXT,
  external_parent_post_id TEXT,
  external_app_id TEXT,
  external_url TEXT,
  external_created_at TIMESTAMPTZ,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  marker_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS social_post_publications_status_idx
  ON social_post_publications (status, created_at);

CREATE INDEX IF NOT EXISTS social_post_publications_account_idx
  ON social_post_publications (platform, external_account_id, external_created_at);

CREATE INDEX IF NOT EXISTS social_post_publications_origin_fingerprint_idx
  ON social_post_publications (platform, origin_fingerprint)
  WHERE origin_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS social_post_publications_external_app_idx
  ON social_post_publications (platform, external_app_id, external_created_at)
  WHERE external_app_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS social_post_publications_origin_idx
  ON social_post_publications (platform, origin_key);

CREATE UNIQUE INDEX IF NOT EXISTS social_post_publications_external_post_idx
  ON social_post_publications (platform, external_post_id)
  WHERE external_post_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS guild_config (
  guild_id TEXT PRIMARY KEY REFERENCES guilds(guild_id),
  announce_channel_id TEXT,
  live_channel_id TEXT,
  socials_feed_channel_id TEXT,
  live_role_id TEXT,
  auto_cleanup BOOLEAN NOT NULL DEFAULT FALSE,
  cooldown_seconds INTEGER NOT NULL DEFAULT 600,
  mention_mode TEXT NOT NULL DEFAULT 'role',
  brand_name TEXT,
  brand_logo_url TEXT,
  preview_image_url TEXT,
  footer_text TEXT,
  guild_twitch_url TEXT,
  guild_youtube_url TEXT,
  guild_kick_url TEXT,
  live_filter_games_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  live_filter_languages_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  live_filter_min_viewers INTEGER,
  live_filter_max_viewers INTEGER,
  category_role_routes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  auto_start_thread BOOLEAN NOT NULL DEFAULT FALSE,
  auto_start_thread_name TEXT,
  stream_end_message_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  stream_end_message_template TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS creator_profiles (
  guild_id TEXT NOT NULL REFERENCES guilds(guild_id),
  discord_user_id TEXT NOT NULL,
  display_name TEXT,
  twitch_url TEXT,
  twitch_external_id TEXT,
  youtube_url TEXT,
  youtube_external_id TEXT,
  kick_url TEXT,
  kick_external_id TEXT,
  kick_slug TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, discord_user_id)
);

CREATE INDEX IF NOT EXISTS creator_profiles_guild_display_idx
  ON creator_profiles (guild_id, display_name);

CREATE TABLE IF NOT EXISTS creator_access (
  guild_id TEXT NOT NULL REFERENCES guilds(guild_id),
  discord_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  submission_source TEXT NOT NULL DEFAULT 'discord',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, discord_user_id)
);

CREATE INDEX IF NOT EXISTS creator_access_status_idx
  ON creator_access (guild_id, status);

CREATE TABLE IF NOT EXISTS guild_creator_activations (
  guild_id TEXT NOT NULL REFERENCES guilds(guild_id),
  discord_user_id TEXT NOT NULL REFERENCES users(discord_user_id),
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  denied_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, discord_user_id)
);

CREATE INDEX IF NOT EXISTS guild_creator_activations_status_idx
  ON guild_creator_activations (guild_id, status);

CREATE TABLE IF NOT EXISTS lite_creators (
  lite_creator_id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(guild_id),
  platform TEXT NOT NULL,
  display_name TEXT,
  url TEXT NOT NULL,
  external_id TEXT,
  added_by_discord_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lite_creators_guild_created_idx
  ON lite_creators (guild_id, created_at, lite_creator_id);

CREATE TABLE IF NOT EXISTS live_sessions (
  guild_id TEXT NOT NULL REFERENCES guilds(guild_id),
  platform TEXT NOT NULL,
  session_key TEXT NOT NULL,
  source_external_id TEXT,
  state TEXT NOT NULL DEFAULT 'active',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, platform, session_key)
);

CREATE INDEX IF NOT EXISTS live_sessions_state_seen_idx
  ON live_sessions (platform, state, last_seen_at);

CREATE TABLE IF NOT EXISTS post_history (
  guild_id TEXT NOT NULL REFERENCES guilds(guild_id),
  platform TEXT NOT NULL,
  session_key TEXT NOT NULL,
  status TEXT NOT NULL,
  discord_message_id TEXT,
  error_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, platform, session_key)
);

CREATE INDEX IF NOT EXISTS post_history_status_idx
  ON post_history (platform, status, updated_at);

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

CREATE TABLE IF NOT EXISTS platform_connections (
  connection_id BIGSERIAL PRIMARY KEY,
  guild_id TEXT REFERENCES guilds(guild_id),
  creator_guild_id TEXT,
  creator_discord_user_id TEXT,
  platform TEXT NOT NULL,
  connection_type TEXT NOT NULL DEFAULT 'team',
  external_account_id TEXT,
  external_account_name TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT platform_connections_creator_fk
    FOREIGN KEY (creator_guild_id, creator_discord_user_id)
    REFERENCES creator_profiles(guild_id, discord_user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS platform_connections_lookup_idx
  ON platform_connections (platform, status, guild_id, creator_discord_user_id);

CREATE TABLE IF NOT EXISTS platform_subscriptions (
  subscription_id BIGSERIAL PRIMARY KEY,
  guild_id TEXT REFERENCES guilds(guild_id),
  creator_guild_id TEXT,
  creator_discord_user_id TEXT,
  platform TEXT NOT NULL,
  topic_key TEXT NOT NULL,
  provider_subscription_id TEXT,
  callback_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  lease_expires_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT platform_subscriptions_creator_fk
    FOREIGN KEY (creator_guild_id, creator_discord_user_id)
    REFERENCES creator_profiles(guild_id, discord_user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS platform_subscriptions_lookup_idx
  ON platform_subscriptions (platform, topic_key, status, lease_expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS platform_subscriptions_scope_topic_idx
  ON platform_subscriptions (
    platform,
    topic_key,
    guild_id,
    creator_guild_id,
    creator_discord_user_id
  )
  NULLS NOT DISTINCT;

CREATE TABLE IF NOT EXISTS event_ingest (
  event_id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_external_id TEXT,
  source_created_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload_json JSONB NOT NULL,
  dedupe_key TEXT,
  processing_state TEXT NOT NULL DEFAULT 'received'
);

CREATE UNIQUE INDEX IF NOT EXISTS event_ingest_dedupe_key_idx
  ON event_ingest (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_ingest_state_received_idx
  ON event_ingest (processing_state, received_at, platform);

CREATE TABLE IF NOT EXISTS job_queue (
  job_id BIGSERIAL PRIMARY KEY,
  queue_name TEXT NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 100,
  dedupe_key TEXT,
  payload_json JSONB NOT NULL,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 10,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS job_queue_dedupe_key_idx
  ON job_queue (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS job_queue_status_available_idx
  ON job_queue (status, available_at, priority, job_id);

CREATE INDEX IF NOT EXISTS job_queue_queue_status_available_idx
  ON job_queue (queue_name, status, available_at, priority, job_id);

CREATE TABLE IF NOT EXISTS audit_log (
  audit_id BIGSERIAL PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  guild_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  action TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_guild_created_idx
  ON audit_log (guild_id, created_at);

CREATE INDEX IF NOT EXISTS audit_log_entity_created_idx
  ON audit_log (entity_type, entity_id, created_at);

CREATE TABLE IF NOT EXISTS ops_pager_incidents (
  incident_id BIGSERIAL PRIMARY KEY,
  incident_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  severity TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_notified_at TIMESTAMPTZ,
  last_delivery_attempt_at TIMESTAMPTZ,
  last_delivery_status TEXT,
  last_delivery_error TEXT,
  last_resolved_at TIMESTAMPTZ,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  last_count INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER NOT NULL DEFAULT 0,
  recovery_count INTEGER NOT NULL DEFAULT 0,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ops_pager_incidents_status_idx
  ON ops_pager_incidents (status, severity, updated_at);

CREATE TABLE IF NOT EXISTS ops_pager_deliveries (
  delivery_id BIGSERIAL PRIMARY KEY,
  incident_id BIGINT REFERENCES ops_pager_incidents(incident_id) ON DELETE CASCADE,
  incident_code TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  delivery_target TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  message_text TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ops_pager_deliveries_created_idx
  ON ops_pager_deliveries (created_at DESC);

CREATE INDEX IF NOT EXISTS ops_pager_deliveries_incident_idx
  ON ops_pager_deliveries (incident_id, created_at DESC);

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
