function normalizeText(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeLower(value) {
  const normalized = normalizeText(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeList(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [values])
        .map((value) => normalizeLower(value))
        .filter(Boolean)
    )
  );
}

function getEventCategory(event = {}) {
  return normalizeText(
    event.game_name ||
    event.category_name ||
    event.category ||
    event.game ||
    event.metadata?.category?.name
  );
}

function getEventLanguage(event = {}) {
  return normalizeText(event.language || event.broadcaster_language || event.locale);
}

function getEventViewerCount(event = {}) {
  const value = Number(event.viewer_count);
  return Number.isFinite(value) ? value : null;
}

function evaluateLiveFilters(target = {}, event = {}) {
  const allowedGames = normalizeList(target.liveFilterGames);
  const allowedLanguages = normalizeList(target.liveFilterLanguages);
  const category = normalizeLower(getEventCategory(event));
  const language = normalizeLower(getEventLanguage(event));
  const viewerCount = getEventViewerCount(event);
  const minViewers = Number(target.liveFilterMinViewers);
  const maxViewers = Number(target.liveFilterMaxViewers);

  if (allowedGames.length && (!category || !allowedGames.includes(category))) {
    return {
      allowed: false,
      reason: "category-filter",
    };
  }

  if (allowedLanguages.length && (!language || !allowedLanguages.includes(language))) {
    return {
      allowed: false,
      reason: "language-filter",
    };
  }

  if (Number.isFinite(minViewers) && viewerCount !== null && viewerCount < minViewers) {
    return {
      allowed: false,
      reason: "min-viewers",
    };
  }

  if (Number.isFinite(maxViewers) && maxViewers > 0 && viewerCount !== null && viewerCount > maxViewers) {
    return {
      allowed: false,
      reason: "max-viewers",
    };
  }

  return {
    allowed: true,
    reason: null,
  };
}

function resolveLiveRoleRouting(target = {}, event = {}) {
  const category = normalizeLower(getEventCategory(event));
  const routes = Array.isArray(target.categoryRoleRoutes) ? target.categoryRoleRoutes : [];
  if (!category) {
    return {
      liveRoleId: target.liveRoleId || null,
      mentionMode: target.mentionMode || "role",
      matchedCategory: null,
    };
  }

  for (const route of routes) {
    const routeCategory = normalizeLower(route?.category || route?.match);
    const routeRoleId = normalizeText(route?.role_id || route?.roleId);
    if (!routeCategory || !routeRoleId) {
      continue;
    }

    if (routeCategory === category) {
      return {
        liveRoleId: routeRoleId,
        mentionMode:
          normalizeText(route?.mention_mode || route?.mentionMode)?.toLowerCase() ||
          target.mentionMode ||
          "role",
        matchedCategory: routeCategory,
      };
    }
  }

  return {
    liveRoleId: target.liveRoleId || null,
    mentionMode: target.mentionMode || "role",
    matchedCategory: null,
  };
}

function formatTemplate(template, values = {}) {
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
    const value = values[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

function buildAutoThreadName(payload = {}) {
  const event = payload.payload || {};
  const base = normalizeText(payload.autoStartThreadName) || "{creator} live chat";
  const category = getEventCategory(event);
  const title = normalizeText(event.title);
  const creator =
    normalizeText(event.broadcaster_user_name) ||
    normalizeText(event.name) ||
    normalizeText(payload.brandName) ||
    "Creator";

  return formatTemplate(base, {
    creator,
    category: category || "Live",
    title: title || "Live now",
    platform: String(payload.platform || "stream").trim(),
  }).slice(0, 100);
}

function buildStreamEndedMessage(payload = {}, event = {}) {
  if (!payload.streamEndMessageEnabled) {
    return null;
  }

  const creator =
    normalizeText(event.broadcaster_user_name) ||
    normalizeText(event.name) ||
    normalizeText(event.broadcaster?.username) ||
    "Creator";
  const category = getEventCategory(event) || "live";
  const platform = normalizeText(payload.platform) || "stream";
  const sourceUrl = normalizeText(event.source_url || event.url);
  const template =
    normalizeText(payload.streamEndMessageTemplate) ||
    "{creator} has wrapped up on {platform}. Catch the replay or stay ready for the next {category} session.";
  const content = formatTemplate(template, {
    creator,
    category,
    platform,
    url: sourceUrl || "",
  }).trim();

  if (!content) {
    return null;
  }

  return {
    content,
    allowed_mentions: { parse: [] },
  };
}

module.exports = {
  buildAutoThreadName,
  buildStreamEndedMessage,
  evaluateLiveFilters,
  getEventCategory,
  resolveLiveRoleRouting,
};
