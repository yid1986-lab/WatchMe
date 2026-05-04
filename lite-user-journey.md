const { isKickConfigured } = require("./kick");
const { isTwitchConfigured } = require("./twitch");
const { isYouTubeConfigured } = require("./youtube");

function isPlatformRenewalSupported(platform, config) {
  const normalizedPlatform = String(platform || "").trim().toLowerCase();

  switch (normalizedPlatform) {
    case "twitch":
      return isTwitchConfigured(config);
    case "youtube":
      return isYouTubeConfigured(config);
    case "kick":
      return isKickConfigured(config);
    default:
      return false;
  }
}

function getRenewablePlatforms(config) {
  return ["twitch", "youtube", "kick"].filter((platform) => {
    return isPlatformRenewalSupported(platform, config);
  });
}

function hasFutureLease(leaseExpiresAt, leadSeconds = 300) {
  if (!leaseExpiresAt) {
    return false;
  }

  const expiresAtMs = new Date(leaseExpiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }

  return expiresAtMs > Date.now() + Math.max(0, Number(leadSeconds || 0)) * 1000;
}

function shouldSkipProviderRenewal(row = {}, options = {}) {
  const canonicalTopicKey = String(options.canonicalTopicKey || "").trim();
  const callbackUrl = String(options.callbackUrl || "").trim();
  const leadSeconds = Number(options.leadSeconds || 300);

  if (String(row.status || "").trim().toLowerCase() !== "active") {
    return false;
  }

  if (!canonicalTopicKey || String(row.topic_key || "").trim() !== canonicalTopicKey) {
    return false;
  }

  if (callbackUrl && String(row.callback_url || "").trim() !== callbackUrl) {
    return false;
  }

  return hasFutureLease(row.lease_expires_at, leadSeconds);
}

module.exports = {
  getRenewablePlatforms,
  hasFutureLease,
  isPlatformRenewalSupported,
  shouldSkipProviderRenewal,
};
