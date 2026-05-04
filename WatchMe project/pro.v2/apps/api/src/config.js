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

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isProductionNodeEnv(nodeEnv) {
  return String(nodeEnv || "").trim().toLowerCase() === "production";
}

function getCompatEnv(primaryNames, fallbackNames, fallback = "", options = {}) {
  const allowFallbacks = options.allowFallbacks !== false;
  return getFirstEnv(allowFallbacks ? [...primaryNames, ...fallbackNames] : primaryNames, fallback);
}

function getApiConfig() {
  const nodeEnv = getEnv("NODE_ENV", "development");
  const allowLegacyFallbacks = !isProductionNodeEnv(nodeEnv);
  return {
    port: Number(getEnv("API_PORT", "3101")),
    databaseUrl: getEnv("DATABASE_URL", "postgres://watchme:watchme@127.0.0.1:5432/watchme_v2"),
    internalApiToken: getCompatEnv(["INTERNAL_API_TOKEN"], ["SESSION_SECRET"], "", { allowFallbacks: allowLegacyFallbacks }),
    liteWriteToken: getEnv("LITE_API_WRITE_TOKEN", ""),
    mobileWriteToken: getCompatEnv(["MOBILE_API_WRITE_TOKEN"], ["PUBLIC_API_WRITE_TOKEN", "SESSION_SECRET"], "", { allowFallbacks: allowLegacyFallbacks }),
    mobileSessionSecret: getCompatEnv(["MOBILE_SESSION_SECRET"], ["SESSION_SECRET"], "", { allowFallbacks: allowLegacyFallbacks }),
    mobileSessionRequired: !["false", "0", "off"].includes(getEnv("MOBILE_SESSION_REQUIRED", "false").toLowerCase()),
    mobileSessionTtlSeconds: Number(getEnv("MOBILE_SESSION_TTL_SECONDS", "3600")),
    firebaseProjectId: getEnv("FIREBASE_PROJECT_ID", ""),
    firebaseServiceAccountJson: getEnv("FIREBASE_SERVICE_ACCOUNT_JSON", ""),
    firebaseServiceAccountPath: getEnv("FIREBASE_SERVICE_ACCOUNT_PATH", ""),
    discordApiBaseUrl: getEnv("DISCORD_API_BASE_URL", "https://discord.com/api/v10"),
    discordBotToken: getEnv("DISCORD_BOT_TOKEN", ""),
    socialOAuthRedirectUri: getEnv("SOCIAL_OAUTH_REDIRECT_URI", "https://pro.watchme-bot.com/api/mobile/social/oauth/callback"),
    facebookRedirectUri: getEnv("FACEBOOK_REDIRECT_URI", ""),
    instagramRedirectUri: getEnv("INSTAGRAM_REDIRECT_URI", ""),
    tiktokRedirectUri: getEnv("TIKTOK_REDIRECT_URI", ""),
    xRedirectUri: getEnv("X_REDIRECT_URI", ""),
    twitchRedirectUri: getEnv("TWITCH_REDIRECT_URI", ""),
    youtubeRedirectUri: getFirstEnv(["YOUTUBE_REDIRECT_URI", "GOOGLE_REDIRECT_URI"], ""),
    facebookAppId: getEnv("FACEBOOK_APP_ID", ""),
    facebookAppSecret: getEnv("FACEBOOK_APP_SECRET", ""),
    facebookGraphVersion: getEnv("FACEBOOK_GRAPH_VERSION", "v22.0"),
    instagramClientId: getFirstEnv(["INSTAGRAM_CLIENT_ID", "FACEBOOK_APP_ID"], ""),
    instagramClientSecret: getFirstEnv(["INSTAGRAM_CLIENT_SECRET", "FACEBOOK_APP_SECRET"], ""),
    tiktokClientKey: getEnv("TIKTOK_CLIENT_KEY", ""),
    tiktokClientSecret: getEnv("TIKTOK_CLIENT_SECRET", ""),
    xClientId: getEnv("X_CLIENT_ID", ""),
    xClientSecret: getEnv("X_CLIENT_SECRET", ""),
    youtubeClientId: getFirstEnv(["YOUTUBE_CLIENT_ID", "GOOGLE_CLIENT_ID"], ""),
    youtubeClientSecret: getFirstEnv(["YOUTUBE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"], ""),
    twitchClientId: getEnv("TWITCH_CLIENT_ID", ""),
    twitchClientSecret: getEnv("TWITCH_CLIENT_SECRET", ""),
    publicWriteToken: getCompatEnv(["PUBLIC_API_WRITE_TOKEN"], ["SESSION_SECRET"], "", { allowFallbacks: allowLegacyFallbacks }),
    workerLockTimeoutSeconds: Number(getEnv("WORKER_LOCK_TIMEOUT_SECONDS", "120")),
    opsBacklogWarningSeconds: Number(getEnv("OPS_BACKLOG_WARNING_SECONDS", "300")),
    opsLeaseWarningSeconds: Number(getEnv("OPS_LEASE_WARNING_SECONDS", "3600")),
    opsWorkerHeartbeatWarningSeconds: Number(getEnv("OPS_WORKER_HEARTBEAT_WARNING_SECONDS", "90")),
    opsWorkerRssWarningBytes: Number(getEnv("OPS_WORKER_RSS_WARNING_BYTES", String(512 * 1024 * 1024))),
    opsWorkerHeapWarningBytes: Number(getEnv("OPS_WORKER_HEAP_WARNING_BYTES", String(256 * 1024 * 1024))),
    opsPagerMinSeverity: getEnv("OPS_PAGER_MIN_SEVERITY", "high"),
    opsPagerCooldownSeconds: Number(getEnv("OPS_PAGER_COOLDOWN_SECONDS", "900")),
    opsPagerReminderSeconds: Number(getEnv("OPS_PAGER_REMINDER_SECONDS", "3600")),
    opsPagerSendRecovery: !["false", "0", "off"].includes(getEnv("OPS_PAGER_SEND_RECOVERY", "true").toLowerCase()),
    opsPagerDiscordWebhookUrl: getEnv("OPS_PAGER_DISCORD_WEBHOOK_URL", ""),
    opsPagerServiceName: getEnv("OPS_PAGER_SERVICE_NAME", "WatchMe V2"),
    opsWorkerRestartStormWindowSeconds: Number(getEnv("OPS_WORKER_RESTART_STORM_WINDOW_SECONDS", "900")),
    opsWorkerRestartStormMinCount: Number(getEnv("OPS_WORKER_RESTART_STORM_MIN_COUNT", "3")),
    opsPagerDeliveryFailWindowSeconds: Number(getEnv("OPS_PAGER_DELIVERY_FAIL_WINDOW_SECONDS", "3600")),
    opsPagerDeliveryFailMinCount: Number(getEnv("OPS_PAGER_DELIVERY_FAIL_MIN_COUNT", "3")),
    opsEscalateWorkerHealthMinOccurrences: Number(getEnv("OPS_ESCALATE_WORKER_HEALTH_MIN_OCCURRENCES", "10")),
    opsEscalateWorkerHealthMinAgeSeconds: Number(getEnv("OPS_ESCALATE_WORKER_HEALTH_MIN_AGE_SECONDS", "1800")),
    ownerProUsers: splitCsv(getEnv("OWNER_PRO_USERS", "")),
    manualProUsers: splitCsv(getEnv("MANUAL_PRO_USERS", "")),
    testerProUsers: splitCsv(getEnv("TESTER_PRO_USERS", "")),
    nodeEnv,
  };
}

function validateApiConfig(config = getApiConfig()) {
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

  if (isProd && !config.publicWriteToken) {
    errors.push("PUBLIC_API_WRITE_TOKEN is required in production.");
  }

  if (isProd && !config.mobileSessionSecret) {
    errors.push("MOBILE_SESSION_SECRET is required in production.");
  }

  if (isProd && !config.mobileSessionRequired) {
    errors.push("MOBILE_SESSION_REQUIRED must be enabled in production.");
  }

  return { errors };
}

module.exports = {
  getApiConfig,
  validateApiConfig,
};
