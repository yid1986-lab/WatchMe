const crypto = require("node:crypto");

const PLATFORMS = ["twitch", "youtube", "kick", "facebook", "instagram", "x"];

const PLAN_LIMITS = {
  lite: {
    maxCreatorsPerGuild: 5,
    supportedPlatforms: ["twitch", "youtube"],
    webUiForRegularUsers: false,
  },
  pro: {
    maxCreatorsPerGuild: null,
    supportedPlatforms: ["twitch", "youtube", "kick", "facebook", "instagram", "x"],
    webUiForRegularUsers: false,
  },
};

const ENTITLEMENT_STATUSES = {
  ACTIVE: "active",
  GRACE_PERIOD: "grace_period",
  INACTIVE: "inactive",
  MANUAL_TEST: "manual_test",
  MANUAL_FREE: "manual_free",
};

const FULL_PRO_STATUSES = new Set([
  ENTITLEMENT_STATUSES.ACTIVE,
  ENTITLEMENT_STATUSES.MANUAL_TEST,
  ENTITLEMENT_STATUSES.MANUAL_FREE,
]);

const SOFT_PRO_STATUSES = new Set([
  ...FULL_PRO_STATUSES,
  ENTITLEMENT_STATUSES.GRACE_PERIOD,
]);

const LITE_SAFE_PLATFORMS = new Set(["twitch", "youtube"]);
const PRO_ONLY_PLATFORMS = new Set(["kick", "facebook", "instagram", "x", "tiktok"]);

const QUEUES = {
  PLATFORM_INGEST: "platform_ingest",
  PLATFORM_SUBSCRIPTION: "platform_subscription",
  LIVE_POST: "live_post",
  SOCIAL_FEED: "social_feed",
  SOCIAL_POST: "social_post",
  MAINTENANCE: "maintenance",
  ENTITLEMENT_SYNC: "entitlement_sync",
};

const JOB_TYPES = {
  INGEST_PLATFORM_EVENT: "ingest_platform_event",
  RENEW_PLATFORM_SUBSCRIPTION: "renew_platform_subscription",
  PROCESS_LIVE_EVENT: "process_live_event",
  DISPATCH_LIVE_POST: "dispatch_live_post",
  PROCESS_SOCIAL_EVENT: "process_social_event",
  DISPATCH_SOCIAL_FEED_POST: "dispatch_social_feed_post",
  DISPATCH_SOCIAL_POST: "dispatch_social_post",
  DISPATCH_MOBILE_PUSH: "dispatch_mobile_push",
  RECONCILE_ENTITLEMENT: "reconcile_entitlement",
};

function buildJobPayload(base = {}) {
  return {
    ...base,
    createdAt: base.createdAt || new Date().toISOString(),
  };
}

function normalizeEntitlementStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (SOFT_PRO_STATUSES.has(normalized) || normalized === ENTITLEMENT_STATUSES.INACTIVE) {
    return normalized;
  }
  return ENTITLEMENT_STATUSES.INACTIVE;
}

function canRunPlatformForEntitlement(platform, entitlementStatus) {
  const normalizedPlatform = String(platform || "").trim().toLowerCase();
  const normalizedStatus = normalizeEntitlementStatus(entitlementStatus);

  if (LITE_SAFE_PLATFORMS.has(normalizedPlatform)) {
    return {
      allowed: true,
      mode: FULL_PRO_STATUSES.has(normalizedStatus) ? "pro" : "lite",
      entitlementStatus: normalizedStatus,
    };
  }

  if (PRO_ONLY_PLATFORMS.has(normalizedPlatform)) {
    return {
      allowed: SOFT_PRO_STATUSES.has(normalizedStatus),
      mode: "pro",
      entitlementStatus: normalizedStatus,
      reason: SOFT_PRO_STATUSES.has(normalizedStatus)
        ? null
        : `Platform ${normalizedPlatform} requires an active Pro entitlement.`,
    };
  }

  return {
    allowed: SOFT_PRO_STATUSES.has(normalizedStatus),
    mode: "pro",
    entitlementStatus: normalizedStatus,
    reason: SOFT_PRO_STATUSES.has(normalizedStatus)
      ? null
      : `Unknown platform ${normalizedPlatform} is treated as Pro-only.`,
  };
}

function buildEventDedupeKey({
  platform,
  eventType,
  sourceKey,
  sourceExternalId,
  sourceCreatedAt,
  providerEventId,
}) {
  const pieces = [
    String(platform || "").trim().toLowerCase(),
    String(eventType || "").trim().toLowerCase(),
    String(sourceKey || "").trim().toLowerCase(),
    String(providerEventId || sourceExternalId || "").trim().toLowerCase(),
    String(sourceCreatedAt || "").trim().toLowerCase(),
  ];

  return pieces.join(":");
}

function buildPlatformTopicKey({ platform, externalId, url, slug }) {
  const normalizedPlatform = String(platform || "").trim().toLowerCase();
  const rawStableId = String(externalId || slug || "").trim();
  const stableId =
    normalizedPlatform === "youtube"
      ? rawStableId
      : rawStableId.toLowerCase();
  if (stableId) {
    return `${normalizedPlatform}:${stableId}`;
  }

  const normalizedUrl = String(url || "").trim().toLowerCase();
  return normalizedUrl ? `${normalizedPlatform}:${normalizedUrl}` : null;
}

function isLiveEventType(eventType) {
  const normalized = String(eventType || "").trim().toLowerCase();
  return [
    "live",
    "live_started",
    "live.start",
    "stream.online",
    "stream_online",
  ].includes(normalized);
}

function isSocialEventType(eventType) {
  return String(eventType || "").trim().toLowerCase() === "social.post.created";
}

function buildLiveSessionKey({
  platform,
  sourceKey,
  sourceExternalId,
  sourceCreatedAt,
  providerEventId,
  eventType,
}) {
  const pieces = [
    String(platform || "").trim().toLowerCase(),
    String(sourceKey || "").trim().toLowerCase(),
    String(providerEventId || sourceExternalId || "").trim().toLowerCase(),
    String(sourceCreatedAt || eventType || "").trim().toLowerCase(),
  ].filter(Boolean);

  return pieces.join(":") || "live:unknown";
}

function buildSocialOriginKey({
  platform,
  dispatchId,
}) {
  const normalizedPlatform = String(platform || "").trim().toLowerCase();
  const normalizedDispatchId = String(dispatchId || "").trim().toLowerCase();

  if (!normalizedPlatform || !normalizedDispatchId) {
    return null;
  }

  return `wm-origin:v1:${normalizedPlatform}:${normalizedDispatchId}`;
}

function buildSocialOriginFingerprint({
  originKey,
  discordUserId,
  connectionId,
}) {
  const normalizedOriginKey = String(originKey || "").trim();
  if (!normalizedOriginKey) {
    return null;
  }

  const hash = crypto.createHash("sha256");
  hash.update(normalizedOriginKey);
  hash.update("|");
  hash.update(String(discordUserId || "").trim().toLowerCase());
  hash.update("|");
  hash.update(String(connectionId || "").trim().toLowerCase());

  return `wmf1_${hash.digest("hex").slice(0, 24)}`;
}

function extractSocialOriginMarkers(values = []) {
  const originKeys = new Set();
  const originFingerprints = new Set();
  const inputs = Array.isArray(values) ? values : [values];

  for (const rawValue of inputs) {
    const value = String(rawValue || "").trim();
    if (!value) {
      continue;
    }

    const originKeyMatches = value.match(/\bwm-origin:v1:[a-z0-9_-]+:[a-z0-9_-]+\b/gi) || [];
    for (const match of originKeyMatches) {
      originKeys.add(String(match).trim().toLowerCase());
    }

    const originFingerprintMatches = value.match(/\bwmf1_[a-f0-9]{24}\b/gi) || [];
    for (const match of originFingerprintMatches) {
      originFingerprints.add(String(match).trim().toLowerCase());
    }
  }

  return {
    originKeys: Array.from(originKeys),
    originFingerprints: Array.from(originFingerprints),
  };
}

module.exports = {
  buildJobPayload,
  buildEventDedupeKey,
  buildPlatformTopicKey,
  buildLiveSessionKey,
  extractSocialOriginMarkers,
  buildSocialOriginFingerprint,
  buildSocialOriginKey,
  canRunPlatformForEntitlement,
  ENTITLEMENT_STATUSES,
  FULL_PRO_STATUSES,
  isLiveEventType,
  isSocialEventType,
  JOB_TYPES,
  LITE_SAFE_PLATFORMS,
  PLAN_LIMITS,
  PLATFORMS,
  PRO_ONLY_PLATFORMS,
  QUEUES,
  SOFT_PRO_STATUSES,
  normalizeEntitlementStatus,
};
