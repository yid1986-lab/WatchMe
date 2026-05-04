const { QUEUES } = require("../../../packages/shared/src");

function getEnv(name, fallback = "") {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return String(value);
}

function getFirstEnv(names, fallback = "") {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && value !== "") {
      return String(value);
    }
  }
  return fallback;
}

function getWorkerQueues() {
  const raw = getEnv("WORKER_QUEUES", "");
  if (!raw) {
    return Object.values(QUEUES);
  }

  return raw
    .split(",")
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function getBooleanEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function isProductionNodeEnv(nodeEnv) {
  return String(nodeEnv || "").trim().toLowerCase() === "production";
}

function getCompatEnv(primaryNames, fallbackNames, fallback = "", options = {}) {
  const allowFallbacks = options.allowFallbacks !== false;
  return getFirstEnv(allowFallbacks ? [...primaryNames, ...fallbackNames] : primaryNames, fallback);
}

function getWorkerConfig() {
  const nodeEnv = getEnv("NODE_ENV", "development");
  const allowLegacyFallbacks = !isProductionNodeEnv(nodeEnv);
  return {
    workerName: getEnv("WORKER_NAME", "watchme-v2-worker"),
    port: Number(getEnv("WORKER_PORT", "3102")),
    databaseUrl: getEnv("DATABASE_URL", "postgres://watchme:watchme@127.0.0.1:5432/watchme_v2"),
    internalApiToken: getCompatEnv(["INTERNAL_API_TOKEN"], ["SESSION_SECRET"], "", { allowFallbacks: allowLegacyFallbacks }),
    firebaseProjectId: getEnv("FIREBASE_PROJECT_ID", ""),
    firebaseServiceAccountJson: getEnv("FIREBASE_SERVICE_ACCOUNT_JSON", ""),
    firebaseServiceAccountPath: getEnv("FIREBASE_SERVICE_ACCOUNT_PATH", ""),
    discordBotToken: getFirstEnv(["DISCORD_BOT_TOKEN", "DISCORD_TOKEN"], ""),
    liteDiscordBotToken: getFirstEnv(["LITE_DISCORD_BOT_TOKEN", "LITE_DISCORD_TOKEN"], ""),
    discordApiBaseUrl: getEnv("DISCORD_API_BASE_URL", "https://discord.com/api/v10"),
    discordMaxRetries: Number(getEnv("DISCORD_MAX_RETRIES", "5")),
    discordRetryBaseMs: Number(getEnv("DISCORD_RETRY_BASE_MS", "1000")),
    facebookApiBaseUrl: getEnv("FACEBOOK_API_BASE_URL", "https://graph.facebook.com"),
    facebookGraphVersion: getEnv("FACEBOOK_GRAPH_VERSION", "v22.0"),
    facebookAppId: getEnv("FACEBOOK_APP_ID", ""),
    instagramApiBaseUrl: getEnv("INSTAGRAM_API_BASE_URL", "https://graph.instagram.com"),
    instagramGraphVersion: getEnv("INSTAGRAM_GRAPH_VERSION", ""),
    instagramAppId: getEnv("INSTAGRAM_APP_ID", ""),
    pollIntervalMs: Number(getEnv("WORKER_POLL_INTERVAL_MS", "2000")),
    heartbeatIntervalMs: Number(getEnv("WORKER_HEARTBEAT_INTERVAL_MS", "15000")),
    batchSize: Number(getEnv("WORKER_BATCH_SIZE", "10")),
    concurrency: Number(getEnv("WORKER_CONCURRENCY", "4")),
    queues: getWorkerQueues(),
    lockTimeoutSeconds: Number(getEnv("WORKER_LOCK_TIMEOUT_SECONDS", "120")),
    twitchClientId: getEnv("TWITCH_CLIENT_ID", ""),
    twitchClientSecret: getEnv("TWITCH_CLIENT_SECRET", ""),
    twitchAuthUrl: getEnv("TWITCH_AUTH_URL", "https://id.twitch.tv/oauth2/token"),
    twitchApiBaseUrl: getEnv("TWITCH_API_BASE_URL", "https://api.twitch.tv/helix"),
    twitchWebhookBaseUrl: getEnv("TWITCH_WEBHOOK_BASE_URL", ""),
    twitchWebhookSecret: getEnv("TWITCH_WEBHOOK_SECRET", ""),
    twitchWebhookPath: getEnv("TWITCH_WEBHOOK_PATH", "/webhooks/twitch"),
    twitchPruneConflictingSubscriptions: getBooleanEnv("TWITCH_PRUNE_CONFLICTING_SUBSCRIPTIONS", false),
    youtubeApiKey: getEnv("YOUTUBE_API_KEY", ""),
    youtubeApiBaseUrl: getEnv("YOUTUBE_API_BASE_URL", "https://www.googleapis.com/youtube/v3"),
    youtubeWebhookBaseUrl: getEnv("YOUTUBE_WEBHOOK_BASE_URL", ""),
    youtubeWebhookPath: getEnv("YOUTUBE_WEBHOOK_PATH", "/webhooks/youtube"),
    youtubeWebhookLegacyPaths: getEnv("YOUTUBE_WEBHOOK_LEGACY_PATHS", "/webhooks/youtube")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    youtubeWebhookHubUrl: getEnv("YOUTUBE_WEBHOOK_HUB_URL", "https://pubsubhubbub.appspot.com/subscribe"),
    youtubeWebhookLeaseSeconds: Number(getEnv("YOUTUBE_WEBHOOK_LEASE_SECONDS", "864000")),
    kickClientId: getEnv("KICK_CLIENT_ID", ""),
    kickClientSecret: getEnv("KICK_CLIENT_SECRET", ""),
    kickApiBaseUrl: getEnv("KICK_API_BASE_URL", "https://api.kick.com/public/v1"),
    kickTokenUrl: getEnv("KICK_TOKEN_URL", "https://id.kick.com/oauth/token"),
    kickPublicKeyUrl: getEnv("KICK_PUBLIC_KEY_URL", "https://api.kick.com/public/v1/public-key"),
    kickWebhookBaseUrl: getEnv("KICK_WEBHOOK_BASE_URL", ""),
    kickWebhookPath: getEnv("KICK_WEBHOOK_PATH", "/webhooks/kick"),
    nodeEnv,
  };
}

function validateWorkerConfig(config = getWorkerConfig()) {
  const errors = [];
  const databaseUrl = String(config.databaseUrl || "").trim();
  const isProd = isProductionNodeEnv(config.nodeEnv);

  if (!databaseUrl) {
    errors.push("DATABASE_URL is required.");
  } else if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
    errors.push("DATABASE_URL must use postgres:// or postgresql://.");
  }

  if (isProd && !config.internalApiToken) {
    errors.push("INTERNAL_API_TOKEN is required in production.");
  }

  if (isProd && !config.discordBotToken) {
    errors.push("DISCORD_BOT_TOKEN is required in production.");
  }

  if (config.twitchWebhookBaseUrl && !config.twitchWebhookSecret) {
    errors.push("TWITCH_WEBHOOK_SECRET is required when TWITCH_WEBHOOK_BASE_URL is set.");
  }

  if (
    isProd &&
    config.youtubeWebhookBaseUrl &&
    String(config.youtubeWebhookPath || "").trim() === "/webhooks/youtube"
  ) {
    errors.push(
      "YOUTUBE_WEBHOOK_PATH must be changed from the default in production so the webhook stays behind an unguessable callback path."
    );
  }

  return { errors };
}

module.exports = {
  getWorkerConfig,
  validateWorkerConfig,
};
