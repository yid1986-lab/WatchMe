import "dotenv/config";

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export const apiConfig = {
  env: String(process.env.NODE_ENV || "development").trim(),
  port: Number.parseInt(String(process.env.WEB_V2_API_PORT || "3102"), 10) || 3102,
  siteName: String(process.env.WEB_V2_SITE_NAME || "WatchMe Web V2").trim(),
  publicOrigin: String(process.env.WEB_V2_PUBLIC_ORIGIN || "http://127.0.0.1:5174").trim(),
  allowedOrigins: splitCsv(process.env.WEB_V2_ALLOWED_ORIGINS || "http://127.0.0.1:5174"),
  sessionSecret: String(process.env.WEB_V2_SESSION_SECRET || "watchme-web-v2-dev-secret").trim(),
  discordClientId: String(process.env.WEB_V2_DISCORD_CLIENT_ID || "").trim(),
  discordClientSecret: String(process.env.WEB_V2_DISCORD_CLIENT_SECRET || "").trim(),
  discordRedirectUriFallback: String(process.env.WEB_V2_DISCORD_REDIRECT_URI || "").trim(),
  discordExtraHosts: splitCsv(process.env.WEB_V2_DISCORD_EXTRA_HOSTS || ""),
  discordOauthTimeoutMs: Math.max(
    5000,
    Math.min(120000, Number.parseInt(String(process.env.WEB_V2_DISCORD_OAUTH_TIMEOUT_MS || "25000"), 10) || 25000)
  ),
  sessionCookieSecure:
    String(process.env.WEB_V2_SESSION_COOKIE_SECURE || "auto").trim() === "true"
      ? true
      : String(process.env.WEB_V2_SESSION_COOKIE_SECURE || "auto").trim() === "false"
        ? false
        : "auto",
  paypalPlanId: String(process.env.WEB_V2_PAYPAL_PLAN_ID || "").trim(),
  proV2ApiBaseUrl: String(process.env.WEB_V2_PRO_V2_API_BASE_URL || "http://127.0.0.1:3101").trim(),
  proV2ApiToken: String(process.env.WEB_V2_PRO_V2_API_TOKEN || "").trim(),
};
