const {
  buildSocialOriginFingerprint,
  buildSocialOriginKey,
  canRunPlatformForEntitlement,
  buildLiveSessionKey,
  isLiveEventType,
  isSocialEventType,
  JOB_TYPES,
} = require("../../../packages/shared/src");
const { getWorkerConfig } = require("./config");
const {
  buildSocialFeedMessagePayload,
  buildLiveMessagePayload,
  createMessageThread,
  doesMessageMatchPayload,
  deleteChannelMessage,
  listChannelMessages,
  sendChannelMessage,
} = require("./discord");
const { log } = require("./logger");
const {
  beginSocialFeedPost,
  beginLivePost,
  createCreatorPostDispatch,
  enqueueLivePostJob,
  enqueuePlatformSubscriptionRenewalJob,
  enqueueProcessLiveEvent,
  enqueueProcessSocialEvent,
  enqueueSocialFeedPostJob,
  enqueueSocialPostDispatchJob,
  getCleanupTargets,
  getCreatorConnections,
  getCreatorDispatch,
  getActiveMobilePushDevices,
  getAutomationActivity,
  getEventById,
  getLiveEventTargets,
  getSocialEventTargets,
  getPlatformSubscriptionById,
  ingestPlatformEvent,
  markLivePostCleared,
  markLivePostDelivered,
  markLivePostFailed,
  markAutomationActivityPushStatus,
  markLiveSessionsInactive,
  markSocialFeedPostDelivered,
  markSocialFeedPostFailed,
  recordAutomationActivityAndQueuePush,
  recordMobilePushDelivery,
  syncPlatformSubscriptionsToCanonicalTopic,
  touchPlatformSubscription,
  updateCreatorDispatch,
  updateEventState,
  updatePlatformSubscriptionById,
  updateSocialPublication,
  recordSocialPublication,
} = require("./store");
const {
  buildPushMessage,
  isMobilePushConfigured,
  sendFirebaseMessage,
} = require("./mobile-push");
const {
  buildFacebookPostLink,
  buildFacebookPostMessage,
  getFacebookConnectionAppId,
  isFacebookConnectionReady,
  publishFacebookPagePost,
} = require("./facebook");
const {
  buildInstagramCaption,
  createInstagramMediaContainer,
  getInstagramConnectionAppId,
  getInstagramPrimaryMediaUrl,
  isInstagramConnectionReady,
  publishInstagramMedia,
} = require("./instagram");
const {
  buildTwitchSourceKey,
  buildWebhookCallbackUrl,
  ensureStreamSubscriptions,
  extractTwitchBroadcasterId,
  getStreamInfo,
  isTwitchConfigured,
  lookupUserByLogin,
  normalizeTwitchUrl,
  parseTwitchLogin,
} = require("./twitch");
const {
  buildYouTubeSourceKey,
  buildYouTubeWebhookCallbackUrl,
  extractYouTubeChannelId,
  getVideoById,
  isYouTubeConfigured,
  normalizeYouTubeChannelUrl,
  resolveChannelId,
  subscribeToChannel,
} = require("./youtube");
const {
  buildKickSourceKey,
  buildKickWebhookCallbackUrl,
  ensureLivestreamSubscriptions,
  extractKickBroadcasterId,
  getLivestreamByBroadcasterId,
  isKickConfigured,
  lookupKickChannel,
  normalizeKickUrl,
  parseKickSlug,
} = require("./kick");
const {
  isPlatformRenewalSupported,
  shouldSkipProviderRenewal,
} = require("./subscription-renewal");
const {
  buildAutoThreadName,
  buildStreamEndedMessage,
  evaluateLiveFilters,
  resolveLiveRoleRouting,
} = require("./live-automation");

const TWITCH_RECONCILE_MS = 6 * 60 * 60 * 1000;
const KICK_RECONCILE_MS = 6 * 60 * 60 * 1000;
const YOUTUBE_RENEWAL_MARGIN_SECONDS = 60 * 60;
const PROVIDER_RENEWAL_SKIP_LEAD_SECONDS = 5 * 60;

function isTwitchOfflineEvent(eventType) {
  return String(eventType || "").trim().toLowerCase() === "stream.offline";
}

function isKickEventType(eventType) {
  return [
    "livestream.status.updated",
    "livestream.metadata.updated",
  ].includes(String(eventType || "").trim().toLowerCase());
}

function isKickOfflineEvent(event = {}) {
  if (String(event.platform || "").trim().toLowerCase() !== "kick") {
    return false;
  }

  if (String(event.event_type || "").trim().toLowerCase() !== "livestream.status.updated") {
    return false;
  }

  return event.payload_json?.event?.is_live === false;
}

function buildSocialPublicationMarker(dispatch, platform, connection, originKey, originFingerprint) {
  return {
    version: 1,
    source: "watchme",
    sourceType: "creator_post_dispatch",
    placeholder: true,
    platform,
    dispatchId: dispatch.dispatch_id,
    templateId: dispatch.template_id || null,
    originKey,
    originFingerprint,
    connectionId: connection?.connection_id || null,
    externalAccountId: connection?.external_account_id || null,
    externalAccountName: connection?.external_account_name || null,
  };
}

function getSocialConnectionAppId(config, platform, connection) {
  if (platform === "facebook") {
    return getFacebookConnectionAppId(config, connection);
  }

  if (platform === "instagram") {
    return getInstagramConnectionAppId(config, connection);
  }

  return String(connection?.metadata_json?.app_id || connection?.metadata_json?.appId || "").trim() || null;
}

async function processConnectedSocialPublication(config, dispatch, platform, connection) {
  const originKey = buildSocialOriginKey({
    platform,
    dispatchId: dispatch.dispatch_id,
  });
  const originFingerprint = buildSocialOriginFingerprint({
    originKey,
    discordUserId: dispatch.discord_user_id,
    connectionId: connection.connection_id,
  });
  const marker = buildSocialPublicationMarker(
    dispatch,
    platform,
    connection,
    originKey,
    originFingerprint
  );
  const queuedPublication = await recordSocialPublication({
    dispatchId: dispatch.dispatch_id,
    discordUserId: dispatch.discord_user_id,
    platform,
    connectionId: connection.connection_id || null,
    status: "queued",
    originKey,
    originFingerprint,
    externalAccountId: connection.external_account_id || null,
    payloadJson: dispatch.payload_json || {},
    markerJson: marker,
  });

  try {
    if (platform === "facebook") {
      const result = await publishFacebookPagePost(config, {
        pageId: connection.external_account_id,
        pageToken: connection.access_token,
        message: buildFacebookPostMessage(dispatch.payload_json || {}),
        link: buildFacebookPostLink(dispatch.payload_json || {}),
      });
      const publishedPublication = await updateSocialPublication(queuedPublication.publication_id, {
        status: "posted",
        externalAccountId: connection.external_account_id || null,
        externalPostId: result?.id || null,
        externalAppId: getFacebookConnectionAppId(config, connection),
        externalUrl: result?.id ? `https://www.facebook.com/${encodeURIComponent(String(result.id))}` : null,
        externalCreatedAt: new Date().toISOString(),
        payloadJson: {
          ...(dispatch.payload_json || {}),
          providerResult: result || null,
        },
        markerJson: {
          ...marker,
          placeholder: false,
          provider: "facebook",
          publishedAt: new Date().toISOString(),
        },
        errorJson: {},
      });

      return {
        status: "posted",
        account: connection.external_account_name || connection.external_account_id,
        publicationId: publishedPublication?.publication_id || queuedPublication.publication_id,
        originKey,
        originFingerprint,
        externalPostId: publishedPublication?.external_post_id || result?.id || null,
      };
    }

    if (platform === "instagram") {
      const container = await createInstagramMediaContainer(config, {
        accountId: connection.external_account_id,
        accessToken: connection.access_token,
        imageUrl: getInstagramPrimaryMediaUrl(dispatch.payload_json || {}),
        caption: buildInstagramCaption(dispatch.payload_json || {}),
      });
      const creationId = container?.id || null;
      if (!creationId) {
        throw new Error("Instagram did not return a media creation id.");
      }

      const result = await publishInstagramMedia(config, {
        accountId: connection.external_account_id,
        accessToken: connection.access_token,
        creationId,
      });

      const publishedPublication = await updateSocialPublication(queuedPublication.publication_id, {
        status: "posted",
        externalAccountId: connection.external_account_id || null,
        externalPostId: result?.id || null,
        externalParentPostId: creationId,
        externalAppId: getInstagramConnectionAppId(config, connection),
        externalCreatedAt: new Date().toISOString(),
        payloadJson: {
          ...(dispatch.payload_json || {}),
          providerResult: {
            container: container || null,
            publish: result || null,
          },
        },
        markerJson: {
          ...marker,
          placeholder: false,
          provider: "instagram",
          publishedAt: new Date().toISOString(),
        },
        errorJson: {},
      });

      return {
        status: "posted",
        account: connection.external_account_name || connection.external_account_id,
        publicationId: publishedPublication?.publication_id || queuedPublication.publication_id,
        originKey,
        originFingerprint,
        externalPostId: publishedPublication?.external_post_id || result?.id || null,
      };
    }

    const placeholderPublication = await updateSocialPublication(queuedPublication.publication_id, {
      status: "recorded_placeholder",
      externalAppId: getSocialConnectionAppId(config, platform, connection),
      payloadJson: dispatch.payload_json || {},
      markerJson: {
        ...marker,
        placeholderRecordedAt: new Date().toISOString(),
      },
      errorJson: {
        placeholder: true,
        providerSendSkipped: true,
      },
    });

    return {
      status: placeholderPublication?.status || "recorded_placeholder",
      account: connection.external_account_name || connection.external_account_id,
      publicationId: placeholderPublication?.publication_id || queuedPublication.publication_id,
      originKey,
      originFingerprint,
    };
  } catch (error) {
    await updateSocialPublication(queuedPublication.publication_id, {
      status: "failed",
      externalAccountId: connection.external_account_id || null,
      externalAppId: getSocialConnectionAppId(config, platform, connection),
      payloadJson: dispatch.payload_json || {},
      markerJson: marker,
      errorJson: {
        message: error?.message || String(error),
        provider: platform,
      },
    }).catch(() => null);
    throw error;
  }
}

function serializeProviderSubscriptions(subscriptions = {}) {
  return Object.fromEntries(
    Object.entries(subscriptions).map(([type, subscription]) => [
      type,
      {
        id: subscription?.id || null,
        status: subscription?.status || null,
      },
    ])
  );
}

function buildNextRenewalPayload(row, metadata = {}) {
  const scope = String(metadata?.scope || "").trim().toLowerCase() === "lite"
    ? "lite"
    : (row.guild_id ? "guild" : "creator");

  return {
    subscriptionId: row.subscription_id,
    platform: row.platform,
    topicKey: row.topic_key,
    guildId: row.guild_id || row.creator_guild_id || null,
    discordUserId: row.creator_discord_user_id || null,
    scope,
    metadata,
  };
}

function getDiscordBotTokenForLivePayload(payload = {}, config = {}) {
  if (String(payload.productScope || "").trim().toLowerCase() === "lite") {
    return config.liteDiscordBotToken || config.discordBotToken;
  }
  return config.discordBotToken;
}

function getDiscordBotTokenForCleanupTarget(target = {}, config = {}) {
  if (String(target.session_key || "").startsWith("lite:")) {
    return config.liteDiscordBotToken || config.discordBotToken;
  }
  return config.discordBotToken;
}

function uniqueStrings(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [values])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function buildTwitchDispatchPayload(rawEvent = {}, streamInfo = {}) {
  const login = streamInfo.broadcaster_user_login || rawEvent.broadcaster_user_login || null;
  return {
    broadcaster_user_id: streamInfo.broadcaster_user_id || rawEvent.broadcaster_user_id || null,
    broadcaster_user_login: login,
    broadcaster_user_name:
      streamInfo.broadcaster_user_name || rawEvent.broadcaster_user_name || login || "Twitch creator",
    title: streamInfo.title || "",
    game_name: streamInfo.game_name || "",
    viewer_count: streamInfo.viewer_count ?? null,
    started_at: streamInfo.started_at || rawEvent.started_at || null,
    thumbnail_url: streamInfo.thumbnail_url || null,
    source_url: login ? normalizeTwitchUrl(login) : null,
  };
}

function buildYouTubeDispatchPayload(rawEntry = {}, video = {}) {
  return {
    broadcaster_user_id: video.channelId || rawEntry.channelId || null,
    broadcaster_user_name: video.channelTitle || rawEntry.channelTitle || "YouTube creator",
    title: video.title || rawEntry.title || "",
    started_at: video.actualStartTime || rawEntry.published || rawEntry.updated || null,
    thumbnail_url: video.thumbnailUrl || rawEntry.thumbnailUrl || null,
    source_url: video.watchUrl || rawEntry.url || null,
  };
}

function buildKickDispatchPayload(rawEvent = {}, livestream = {}) {
  const broadcaster = rawEvent.broadcaster || {};
  return {
    broadcaster_user_id: livestream.broadcasterId || broadcaster.user_id || null,
    broadcaster_user_name: livestream.slug || broadcaster.username || "Kick creator",
    title: livestream.title || rawEvent.title || rawEvent.metadata?.title || "",
    game_name: livestream.categoryName || rawEvent.metadata?.category?.name || "",
    viewer_count: livestream.viewerCount ?? null,
    started_at: livestream.startedAt || rawEvent.started_at || null,
    thumbnail_url: livestream.thumbnailUrl || broadcaster.profile_picture || null,
    source_url: livestream.sourceUrl || normalizeKickUrl(livestream.slug || broadcaster.channel_slug),
  };
}

function buildLiveSocialDispatchPayload({
  platform,
  dispatchPayload = {},
  sourceCreatedAt = null,
} = {}) {
  const platformLabel = String(platform || "").trim() || "stream";
  const creatorName =
    dispatchPayload.broadcaster_user_name ||
    dispatchPayload.channel_title ||
    dispatchPayload.name ||
    "Creator";
  const title = String(dispatchPayload.title || "").trim();
  const sourceUrl = dispatchPayload.source_url || dispatchPayload.url || null;
  const category = String(dispatchPayload.game_name || dispatchPayload.category_name || "").trim();
  const lines = [
    `${creatorName} is live on ${platformLabel}.`,
    title,
    category ? `Category: ${category}` : null,
    sourceUrl,
  ].filter(Boolean);

  return {
    post_text: lines.join("\n"),
    link_url: sourceUrl,
    media_urls_json: [dispatchPayload.thumbnail_url].filter(Boolean),
    metadata_json: {
      automation: "live_social_fanout",
      platform,
      started_at: dispatchPayload.started_at || sourceCreatedAt || null,
    },
  };
}

async function enqueueLiveSocialDispatches({
  creatorDiscordUserIds = [],
  platform,
  sessionKey,
  targetSourceKey,
  sourceCreatedAt,
  dispatchPayload,
} = {}) {
  const uniqueCreatorIds = Array.from(new Set(
    creatorDiscordUserIds
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ));

  for (const discordUserId of uniqueCreatorIds) {
    const connections = await getCreatorConnections(discordUserId);
    const targetPlatforms = connections
      .filter((connection) => {
        return (
          String(connection.status || "").trim().toLowerCase() === "active" &&
          String(connection.external_account_id || "").trim()
        );
      })
      .map((connection) => String(connection.platform || "").trim().toLowerCase())
      .filter(Boolean);

    if (!targetPlatforms.length) {
      continue;
    }

    const payload = {
      ...buildLiveSocialDispatchPayload({
        platform,
        dispatchPayload,
        sourceCreatedAt,
      }),
      target_platforms_json: targetPlatforms,
    };
    const sourceKey = `live:${platform}:${targetSourceKey || "unknown"}:${sessionKey || sourceCreatedAt || "unknown"}`;
    const dispatch = await createCreatorPostDispatch(discordUserId, {
      status: "queued",
      source_type: "live_automation",
      source_key: sourceKey,
      target_platforms_json: targetPlatforms,
      payload_json: payload,
    });

    if (!dispatch?.dispatch_id) {
      continue;
    }

    await enqueueSocialPostDispatchJob(discordUserId, dispatch.dispatch_id, {
      targetPlatforms,
      payload,
      sourceType: "live_automation",
      sourceKey,
    });
  }
}

function shouldProcessPlatformEvent(event = {}) {
  if (isSocialEventType(event.event_type)) {
    return true;
  }

  if (event.platform === "youtube") {
    return true;
  }

  if (event.platform === "kick") {
    return isKickEventType(event.event_type);
  }

  return isLiveEventType(event.event_type) || isTwitchOfflineEvent(event.event_type);
}

function buildSocialEventDispatchPayload(event = {}) {
  const payload = event.payload_json || {};
  const candidate = payload.candidate || {};
  const metadata = payload.metadata_json || candidate.metadata_json || {};
  const username = String(metadata.username || "").trim().replace(/^@+/, "") || null;
  return {
    creator_display_name: payload.creator_display_name || null,
    external_account_id: payload.external_account_id || candidate.external_account_id || null,
    external_account_name: payload.external_account_name || candidate.external_account_name || null,
    external_account_url: payload.external_account_url || null,
    external_account_handle:
      payload.external_account_handle ||
      (username ? `@${username}` : null),
    external_post_id: payload.external_post_id || candidate.external_post_id || event.source_external_id || null,
    external_parent_post_id:
      payload.external_parent_post_id || candidate.external_parent_post_id || null,
    external_post_url:
      payload.external_post_url ||
      candidate.external_post_url ||
      (Array.isArray(candidate.normalized_urls) ? candidate.normalized_urls[0] : null) ||
      null,
    source_url: payload.source_url || null,
    normalized_text: payload.normalized_text || candidate.normalized_text || "",
    normalized_urls: Array.isArray(payload.normalized_urls)
      ? payload.normalized_urls
      : (Array.isArray(candidate.normalized_urls) ? candidate.normalized_urls : []),
    media_urls_json: Array.isArray(payload.media_urls_json)
      ? payload.media_urls_json
      : (Array.isArray(candidate.media_urls_json) ? candidate.media_urls_json : []),
    media_type: payload.media_type || metadata.media_type || null,
    media_product_type: payload.media_product_type || metadata.media_product_type || null,
    content_type: payload.content_type || metadata.content_type || null,
    content_label: payload.content_label || metadata.content_label || null,
    metadata_json: payload.metadata_json || candidate.metadata_json || {},
    published_at: event.source_created_at || null,
  };
}

async function enqueueTwitchLiveCatchupIfNeeded(config, broadcasterId, sourceKey) {
  const streamInfo = await getStreamInfo(config, broadcasterId).catch(() => null);
  if (!streamInfo?.id && !streamInfo?.started_at) {
    return null;
  }

  const sourceCreatedAt = streamInfo.started_at || new Date().toISOString();
  const providerEventId = `catchup:${broadcasterId}:${streamInfo.id || sourceCreatedAt}`;
  const event = await ingestPlatformEvent({
    platform: "twitch",
    eventType: "stream.online",
    sourceKey,
    sourceExternalId: broadcasterId,
    sourceCreatedAt,
    providerEventId,
    dedupeKey: `twitch:catchup:${broadcasterId}:${streamInfo.id || sourceCreatedAt}`,
    payload: {
      catchup: true,
      event: {
        broadcaster_user_id: broadcasterId,
        broadcaster_user_login: streamInfo.broadcaster_user_login || null,
        broadcaster_user_name: streamInfo.broadcaster_user_name || null,
        started_at: sourceCreatedAt,
      },
      stream: streamInfo,
    },
  });

  await enqueueProcessLiveEvent({
    eventId: event.event_id,
    platform: event.platform,
    eventType: event.event_type,
    sourceKey: event.source_key,
    sourceExternalId: event.source_external_id,
    sourceCreatedAt: event.source_created_at,
    sessionKey: buildLiveSessionKey({
      platform: event.platform,
      sourceKey: event.source_key,
      sourceExternalId: event.source_external_id,
      sourceCreatedAt: event.source_created_at,
      providerEventId,
      eventType: event.event_type,
    }),
    payload: event.payload_json || {},
  });

  log("info", "subscriptions", `Queued Twitch live catch-up for ${sourceKey}`);
  return event;
}

async function handleRenewTwitchPlatformSubscription(payload, config) {
  if (!isTwitchConfigured(config)) {
    throw new Error("Twitch webhook configuration is incomplete.");
  }

  let row = payload.subscriptionId ? await getPlatformSubscriptionById(payload.subscriptionId) : null;
  if (!row) {
    row = await touchPlatformSubscription({
      ...payload,
      workerName: config.workerName,
      callbackUrl: buildWebhookCallbackUrl(config),
    });
  }

  if (!row) {
    throw new Error("Unable to load or create the platform subscription row.");
  }

  const metadata = row.metadata_json || {};
  const sourceUrl = metadata.sourceUrl || payload?.metadata?.sourceUrl || null;

  let broadcasterId = extractTwitchBroadcasterId(row.topic_key) || metadata.broadcasterId || null;
  let broadcasterLogin = metadata.broadcasterLogin || parseTwitchLogin(sourceUrl || row.topic_key);
  let broadcasterName = metadata.broadcasterName || null;

  const callbackUrl = buildWebhookCallbackUrl(config);
  const existingCanonicalTopicKey = broadcasterId ? buildTwitchSourceKey(broadcasterId) : null;
  if (
    existingCanonicalTopicKey &&
    shouldSkipProviderRenewal(row, {
      canonicalTopicKey: existingCanonicalTopicKey,
      callbackUrl,
      leadSeconds: PROVIDER_RENEWAL_SKIP_LEAD_SECONDS,
    })
  ) {
    log(
      "info",
      "subscriptions",
      `Skipped Twitch renewal for ${row.subscription_id}; lease is still healthy for ${existingCanonicalTopicKey}`
    );
    return;
  }

  if (!broadcasterId) {
    if (!broadcasterLogin) {
      throw new Error(`Could not resolve a Twitch login for ${row.topic_key}`);
    }

    const user = await lookupUserByLogin(config, broadcasterLogin);
    if (!user?.id) {
      throw new Error(`Could not resolve Twitch broadcaster for ${broadcasterLogin}`);
    }

    broadcasterId = user.id;
    broadcasterLogin = user.login;
    broadcasterName = user.displayName || broadcasterName;
  }

  const providerSubscriptions = await ensureStreamSubscriptions(config, broadcasterId);
  const topicKey = buildTwitchSourceKey(broadcasterId);
  const leaseExpiresAt = new Date(Date.now() + TWITCH_RECONCILE_MS).toISOString();

  const updatedRows = await syncPlatformSubscriptionsToCanonicalTopic({
    platform: "twitch",
    canonicalTopicKey: topicKey,
    topicKeys: uniqueStrings([
      row.topic_key,
      broadcasterLogin ? `twitch:${broadcasterLogin}` : null,
      sourceUrl ? `twitch:${String(sourceUrl).trim().toLowerCase()}` : null,
    ]),
    sourceUrls: uniqueStrings([
      sourceUrl,
      broadcasterLogin ? normalizeTwitchUrl(broadcasterLogin) : null,
    ]),
    patch: {
      providerSubscriptionId: providerSubscriptions["stream.online"]?.id || null,
      callbackUrl,
      status: "active",
      leaseExpiresAt,
      lastVerifiedAt: new Date().toISOString(),
      metadataJson: {
        sourceUrl: broadcasterLogin ? normalizeTwitchUrl(broadcasterLogin) : sourceUrl,
        broadcasterId,
        broadcasterLogin,
        broadcasterName,
        providerSubscriptions: serializeProviderSubscriptions(providerSubscriptions),
        lastReconciledAt: new Date().toISOString(),
      },
    },
  });

  const updated =
    updatedRows.find((item) => item.subscription_id === row.subscription_id) ||
    await getPlatformSubscriptionById(row.subscription_id);

  if (updated) {
    await enqueuePlatformSubscriptionRenewalJob(
      buildNextRenewalPayload(updated, updated.metadata_json || {}),
      leaseExpiresAt
    );
  }

  await enqueueTwitchLiveCatchupIfNeeded(config, broadcasterId, topicKey);

  log(
    "info",
    "subscriptions",
    `Reconciled Twitch subscription ${updated.subscription_id} for ${topicKey}`
  );
}

async function handleRenewYouTubePlatformSubscription(payload, config) {
  if (!isYouTubeConfigured(config)) {
    throw new Error("YouTube webhook configuration is incomplete.");
  }

  let row = payload.subscriptionId ? await getPlatformSubscriptionById(payload.subscriptionId) : null;
  if (!row) {
    row = await touchPlatformSubscription({
      ...payload,
      workerName: config.workerName,
      callbackUrl: buildYouTubeWebhookCallbackUrl(config),
    });
  }

  if (!row) {
    throw new Error("Unable to load or create the YouTube subscription row.");
  }

  const metadata = row.metadata_json || {};
  const sourceUrl = metadata.sourceUrl || payload?.metadata?.sourceUrl || null;
  const callbackUrl = buildYouTubeWebhookCallbackUrl(config);

  let channelId = extractYouTubeChannelId(row.topic_key) || extractYouTubeChannelId(metadata.channelId);
  const existingCanonicalTopicKey = channelId ? buildYouTubeSourceKey(channelId) : null;
  if (
    existingCanonicalTopicKey &&
    shouldSkipProviderRenewal(row, {
      canonicalTopicKey: existingCanonicalTopicKey,
      callbackUrl,
      leadSeconds: YOUTUBE_RENEWAL_MARGIN_SECONDS,
    })
  ) {
    log(
      "info",
      "subscriptions",
      `Skipped YouTube renewal for ${row.subscription_id}; lease is still healthy for ${existingCanonicalTopicKey}`
    );
    return;
  }

  if (!channelId) {
    channelId = await resolveChannelId(config, sourceUrl || row.topic_key);
  }

  if (!channelId) {
    throw new Error(`Could not resolve a YouTube channel for ${row.topic_key}`);
  }

  const subscription = await subscribeToChannel(config, channelId, "subscribe");
  const leaseSeconds = Number(subscription.leaseSeconds || config.youtubeWebhookLeaseSeconds || 864000);
  const leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
  const renewAt = new Date(
    Date.now() + Math.max(60, leaseSeconds - YOUTUBE_RENEWAL_MARGIN_SECONDS) * 1000
  ).toISOString();
  const topicKey = buildYouTubeSourceKey(channelId);
  const updatedRows = await syncPlatformSubscriptionsToCanonicalTopic({
    platform: "youtube",
    canonicalTopicKey: topicKey,
    topicKeys: uniqueStrings([
      row.topic_key,
      sourceUrl ? `youtube:${String(sourceUrl).trim().toLowerCase()}` : null,
    ]),
    sourceUrls: uniqueStrings([
      sourceUrl,
      normalizeYouTubeChannelUrl(channelId),
    ]),
    patch: {
      callbackUrl,
      status: "active",
      leaseExpiresAt,
      metadataJson: {
        sourceUrl: sourceUrl || normalizeYouTubeChannelUrl(channelId),
        channelId,
        hubTopic: subscription.topic,
        hubLeaseSeconds: leaseSeconds,
        lastRenewedAt: new Date().toISOString(),
        lastReconciledAt: new Date().toISOString(),
      },
    },
  });

  const updated =
    updatedRows.find((item) => item.subscription_id === row.subscription_id) ||
    await getPlatformSubscriptionById(row.subscription_id);

  if (updated) {
    await enqueuePlatformSubscriptionRenewalJob(
      buildNextRenewalPayload(updated, updated.metadata_json || {}),
      renewAt
    );
  }

  log(
    "info",
    "subscriptions",
    `Reconciled YouTube subscription ${updated.subscription_id} for ${topicKey}`
  );
}

async function handleRenewKickPlatformSubscription(payload, config) {
  if (!isKickConfigured(config)) {
    throw new Error("Kick webhook configuration is incomplete.");
  }

  let row = payload.subscriptionId ? await getPlatformSubscriptionById(payload.subscriptionId) : null;
  if (!row) {
    row = await touchPlatformSubscription({
      ...payload,
      workerName: config.workerName,
      callbackUrl: buildKickWebhookCallbackUrl(config),
    });
  }

  if (!row) {
    throw new Error("Unable to load or create the Kick subscription row.");
  }

  const metadata = row.metadata_json || {};
  const sourceUrl = metadata.sourceUrl || payload?.metadata?.sourceUrl || null;
  const callbackUrl = buildKickWebhookCallbackUrl(config);

  let broadcasterId = extractKickBroadcasterId(row.topic_key) || metadata.broadcasterId || null;
  let broadcasterSlug = metadata.broadcasterSlug || parseKickSlug(sourceUrl || row.topic_key);
  let broadcasterName = metadata.broadcasterName || null;
  const existingCanonicalTopicKey = broadcasterId ? buildKickSourceKey(broadcasterId) : null;
  if (
    existingCanonicalTopicKey &&
    shouldSkipProviderRenewal(row, {
      canonicalTopicKey: existingCanonicalTopicKey,
      callbackUrl,
      leadSeconds: PROVIDER_RENEWAL_SKIP_LEAD_SECONDS,
    })
  ) {
    log(
      "info",
      "subscriptions",
      `Skipped Kick renewal for ${row.subscription_id}; lease is still healthy for ${existingCanonicalTopicKey}`
    );
    return;
  }

  if (!broadcasterId) {
    const channel = await lookupKickChannel(config, broadcasterId || broadcasterSlug || sourceUrl || row.topic_key);
    if (!channel?.broadcasterId) {
      throw new Error(`Could not resolve a Kick broadcaster for ${row.topic_key}`);
    }

    broadcasterId = channel.broadcasterId;
    broadcasterSlug = channel.slug || broadcasterSlug;
    broadcasterName = channel.name || broadcasterName;
  }

  const providerSubscriptions = await ensureLivestreamSubscriptions(config, broadcasterId);
  const topicKey = buildKickSourceKey(broadcasterId);
  const leaseExpiresAt = new Date(Date.now() + KICK_RECONCILE_MS).toISOString();
  const updatedRows = await syncPlatformSubscriptionsToCanonicalTopic({
    platform: "kick",
    canonicalTopicKey: topicKey,
    topicKeys: uniqueStrings([
      row.topic_key,
      broadcasterSlug ? `kick:${broadcasterSlug}` : null,
      sourceUrl ? `kick:${String(sourceUrl).trim().toLowerCase()}` : null,
    ]),
    sourceUrls: uniqueStrings([
      sourceUrl,
      broadcasterSlug ? normalizeKickUrl(broadcasterSlug) : null,
    ]),
    patch: {
      callbackUrl,
      status: "active",
      leaseExpiresAt,
      lastVerifiedAt: new Date().toISOString(),
      metadataJson: {
        sourceUrl: broadcasterSlug ? normalizeKickUrl(broadcasterSlug) : sourceUrl,
        broadcasterId,
        broadcasterSlug,
        broadcasterName,
        providerSubscriptions,
        lastReconciledAt: new Date().toISOString(),
      },
    },
  });

  const updated =
    updatedRows.find((item) => item.subscription_id === row.subscription_id) ||
    await getPlatformSubscriptionById(row.subscription_id);

  if (updated) {
    await enqueuePlatformSubscriptionRenewalJob(
      buildNextRenewalPayload(updated, updated.metadata_json || {}),
      leaseExpiresAt
    );
  }

  log(
    "info",
    "subscriptions",
    `Reconciled Kick subscription ${updated.subscription_id} for ${topicKey}`
  );
}

async function handleRenewPlatformSubscription(job) {
  const payload = job.payload_json || {};
  const config = getWorkerConfig();

  if (!isPlatformRenewalSupported(payload.platform, config)) {
    log(
      "info",
      "subscriptions",
      `Skipped ${payload.platform || "unknown"} renewal job ${job.job_id}: connector not configured in this worker`
    );
    return;
  }

  if (payload.platform === "twitch") {
    return handleRenewTwitchPlatformSubscription(payload, config);
  }

  if (payload.platform === "youtube") {
    return handleRenewYouTubePlatformSubscription(payload, config);
  }

  if (payload.platform === "kick") {
    return handleRenewKickPlatformSubscription(payload, config);
  }

  const subscription = await touchPlatformSubscription({
    ...payload,
    workerName: config.workerName,
  });

  log(
    "info",
    "subscriptions",
    `Renewed placeholder ${payload.platform || "unknown"} subscription ${subscription?.subscription_id || "new"} for ${payload.topicKey || "unknown"}`
  );
}

async function handleIngestPlatformEvent(job) {
  const payload = job.payload_json || {};
  const event = await getEventById(payload.eventId);

  if (!event) {
    throw new Error(`Event ${payload.eventId} was not found`);
  }

  if (event.processing_state === "processed" || event.processing_state === "ignored") {
    return;
  }

  const shouldProcess = shouldProcessPlatformEvent(event);
  if (!shouldProcess) {
    await updateEventState(event.event_id, "ignored");
    log("info", "ingest", `Ignored unsupported event ${event.event_id} (${event.event_type})`);
    return;
  }

  await updateEventState(event.event_id, "queued");
  if (isSocialEventType(event.event_type)) {
    await enqueueProcessSocialEvent({
      eventId: event.event_id,
      platform: event.platform,
      eventType: event.event_type,
      sourceKey: event.source_key,
      sourceExternalId: event.source_external_id,
      sourceCreatedAt: event.source_created_at,
      sessionKey: `social:${event.platform}:${event.source_external_id || event.event_id}`,
      payload: event.payload_json || {},
    });
  } else {
    await enqueueProcessLiveEvent({
      eventId: event.event_id,
      platform: event.platform,
      eventType: event.event_type,
      sourceKey: event.source_key,
      sourceExternalId: event.source_external_id,
      sourceCreatedAt: event.source_created_at,
      sessionKey: payload.sessionKey,
      payload: event.payload_json || {},
    });
  }

  log("info", "ingest", `Accepted event ${event.event_id} for processing`);
}

async function sendStreamEndFollowUp(config, target, event) {
  if (!target.stream_end_message_enabled || !target.channel_id) {
    return false;
  }

  const followUpPayload = buildStreamEndedMessage(
    {
      platform: target.platform,
      streamEndMessageEnabled: target.stream_end_message_enabled,
      streamEndMessageTemplate: target.stream_end_message_template,
    },
    event.payload_json?.event || {}
  );

  if (!followUpPayload) {
    return false;
  }

  await sendChannelMessage(target.channel_id, getDiscordBotTokenForCleanupTarget(target, config), followUpPayload, {
    apiBaseUrl: config.discordApiBaseUrl,
    maxRetries: config.discordMaxRetries,
    baseRetryMs: config.discordRetryBaseMs,
  });
  return true;
}

async function handleTwitchOfflineCleanup(event) {
  const cleanupTargets = await getCleanupTargets("twitch", event.source_external_id);
  const config = getWorkerConfig();
  let deleted = 0;
  let followUps = 0;

  for (const target of cleanupTargets) {
    if (target.stream_end_message_enabled && target.channel_id) {
      try {
        const sent = await sendStreamEndFollowUp(config, target, event);
        if (sent) {
          followUps += 1;
        }
      } catch (error) {
        log(
          "warn",
          "live_post",
          `Cleanup follow-up failed for guild ${target.guild_id}: ${error?.message || error}`
        );
      }
    }

    if (!target.auto_cleanup || !target.channel_id || !target.discord_message_id) {
      continue;
    }

    try {
      await deleteChannelMessage(target.channel_id, target.discord_message_id, getDiscordBotTokenForCleanupTarget(target, config), {
        apiBaseUrl: config.discordApiBaseUrl,
        maxRetries: config.discordMaxRetries,
        baseRetryMs: config.discordRetryBaseMs,
      });
      await markLivePostCleared(target.guild_id, target.platform, target.session_key);
      deleted += 1;
    } catch (error) {
      log(
        "warn",
        "live_post",
        `Cleanup delete failed for guild ${target.guild_id}: ${error?.message || error}`
      );
    }
  }

  await markLiveSessionsInactive("twitch", event.source_external_id);
  log(
    "info",
    "fanout",
    `Processed Twitch offline cleanup for ${event.source_external_id}; deleted ${deleted} message(s), sent ${followUps} follow-up(s)`
  );
}

async function handleKickOfflineCleanup(event) {
  const cleanupTargets = await getCleanupTargets("kick", event.source_external_id);
  const config = getWorkerConfig();
  let deleted = 0;
  let followUps = 0;

  for (const target of cleanupTargets) {
    if (target.stream_end_message_enabled && target.channel_id) {
      try {
        const sent = await sendStreamEndFollowUp(config, target, event);
        if (sent) {
          followUps += 1;
        }
      } catch (error) {
        log(
          "warn",
          "live_post",
          `Kick cleanup follow-up failed for guild ${target.guild_id}: ${error?.message || error}`
        );
      }
    }

    if (!target.auto_cleanup || !target.channel_id || !target.discord_message_id) {
      continue;
    }

    try {
      await deleteChannelMessage(target.channel_id, target.discord_message_id, getDiscordBotTokenForCleanupTarget(target, config), {
        apiBaseUrl: config.discordApiBaseUrl,
        maxRetries: config.discordMaxRetries,
        baseRetryMs: config.discordRetryBaseMs,
      });
      await markLivePostCleared(target.guild_id, target.platform, target.session_key);
      deleted += 1;
    } catch (error) {
      log(
        "warn",
        "live_post",
        `Kick cleanup delete failed for guild ${target.guild_id}: ${error?.message || error}`
      );
    }
  }

  await markLiveSessionsInactive("kick", event.source_external_id);
  log(
    "info",
    "fanout",
    `Processed Kick offline cleanup for ${event.source_external_id}; deleted ${deleted} message(s), sent ${followUps} follow-up(s)`
  );
}

async function handleProcessLiveEvent(job) {
  const payload = job.payload_json || {};
  const config = getWorkerConfig();
  const event = await getEventById(payload.eventId);

  if (!event) {
    throw new Error(`Event ${payload.eventId} was not found`);
  }

  if (event.processing_state === "processed") {
    return;
  }

  await updateEventState(event.event_id, "processing");

  if (event.platform === "twitch" && isTwitchOfflineEvent(event.event_type)) {
    await handleTwitchOfflineCleanup(event);
    await updateEventState(event.event_id, "processed");
    return;
  }

  if (isKickOfflineEvent(event)) {
    await handleKickOfflineCleanup(event);
    await updateEventState(event.event_id, "processed");
    return;
  }

  const rawEvent = event.payload_json?.event || {};
  let dispatchPayload = event.payload_json || {};
  let sessionKey = payload.sessionKey || `live:${event.event_id}`;
  let targetSourceKey = event.source_key;

  if (event.platform === "twitch") {
    const streamInfo = await getStreamInfo(config, event.source_external_id).catch(() => null);
    const livePayload = buildTwitchDispatchPayload(rawEvent, streamInfo || {});
    dispatchPayload = livePayload;

    if (streamInfo?.id) {
      sessionKey = `twitch:${event.source_external_id}:${streamInfo.id}`;
    } else if (livePayload.started_at) {
      sessionKey = `twitch:${event.source_external_id}:${livePayload.started_at}`;
    }
  } else if (event.platform === "youtube") {
    const rawEntry = event.payload_json?.entry || {};
    const video = await getVideoById(config, event.source_external_id);

    if (!video?.videoId || !video?.channelId || !video.isActiveLive) {
      await updateEventState(event.event_id, "ignored");
      log("info", "fanout", `Ignored non-live YouTube event ${event.event_id} for ${event.source_external_id}`);
      return;
    }

    dispatchPayload = buildYouTubeDispatchPayload(rawEntry, video);
    targetSourceKey = buildYouTubeSourceKey(video.channelId);
    sessionKey = `youtube:${video.channelId}:${video.videoId}`;
  } else if (event.platform === "kick") {
    const livestream = await getLivestreamByBroadcasterId(config, event.source_external_id).catch(() => null);
    const rawBroadcasterId = rawEvent?.broadcaster?.user_id ? String(rawEvent.broadcaster.user_id) : null;

    if (!livestream?.broadcasterId && rawEvent.is_live === true && rawBroadcasterId) {
      dispatchPayload = buildKickDispatchPayload(rawEvent, {
        broadcasterId: rawBroadcasterId,
        slug: rawEvent?.broadcaster?.channel_slug || null,
        title: rawEvent.title || rawEvent.metadata?.title || "",
        categoryName: rawEvent.metadata?.category?.name || "",
        startedAt: rawEvent.started_at || event.source_created_at || null,
        thumbnailUrl: rawEvent?.broadcaster?.profile_picture || null,
        sourceUrl: normalizeKickUrl(rawEvent?.broadcaster?.channel_slug),
        isLive: true,
      });
      targetSourceKey = buildKickSourceKey(rawBroadcasterId);
      sessionKey = `kick:${rawBroadcasterId}:${rawEvent.started_at || event.source_created_at || event.event_id}`;
    } else if (!livestream?.broadcasterId || !livestream.isLive) {
      await updateEventState(event.event_id, "ignored");
      log("info", "fanout", `Ignored non-live Kick event ${event.event_id} for ${event.source_external_id}`);
      return;
    } else {
      dispatchPayload = buildKickDispatchPayload(rawEvent, livestream);
      targetSourceKey = buildKickSourceKey(livestream.broadcasterId);
      sessionKey = `kick:${livestream.broadcasterId}:${livestream.startedAt || event.source_created_at || event.event_id}`;
    }
  }

  const targets = await getLiveEventTargets(event.platform, targetSourceKey);
  let enqueued = 0;
  const socialFanoutCreatorIds = [];

  for (const target of targets) {
    if (target.productScope === "lite" && !config.liteDiscordBotToken) {
      log(
        "warn",
        "fanout",
        `Skipped Lite target ${target.guildId} for ${event.platform} ${targetSourceKey}: Lite Discord runtime is not configured in this worker`
      );
      continue;
    }

    const entitlement = canRunPlatformForEntitlement(event.platform, target.entitlementStatus);
    if (!entitlement.allowed) {
      log(
        "warn",
        "fanout",
        `Skipped guild ${target.guildId} for ${event.platform} ${targetSourceKey}: ${entitlement.reason || "blocked"}`
      );
      continue;
    }

    const filterDecision = evaluateLiveFilters(target, dispatchPayload);
    if (!filterDecision.allowed) {
      log(
        "info",
        "fanout",
        `Skipped guild ${target.guildId} for ${event.platform} ${targetSourceKey}: ${filterDecision.reason}`
      );
      continue;
    }

    const routing = resolveLiveRoleRouting(target, dispatchPayload);
    if (target.creatorDiscordUserId) {
      socialFanoutCreatorIds.push(target.creatorDiscordUserId);
    }

    await enqueueLivePostJob(
      {
        ...target,
        liveRoleId: routing.liveRoleId,
        mentionMode: routing.mentionMode,
        deliveryMode: entitlement.mode,
      },
      {
        eventId: event.event_id,
        platform: event.platform,
        eventType: event.event_type,
        sourceKey: targetSourceKey,
        sourceExternalId: event.source_external_id,
        sourceCreatedAt: event.source_created_at,
        sessionKey,
        payload: dispatchPayload,
      }
    );

    enqueued += 1;
  }

  await enqueueLiveSocialDispatches({
    creatorDiscordUserIds: socialFanoutCreatorIds,
    platform: event.platform,
    sessionKey,
    targetSourceKey,
    sourceCreatedAt: event.source_created_at,
    dispatchPayload,
  });

  for (const discordUserId of Array.from(new Set(socialFanoutCreatorIds.filter(Boolean)))) {
    await recordAutomationActivityAndQueuePush(discordUserId, {
      event_type: "live.detected",
      title: "Creator just went live",
      body: `${dispatchPayload.creatorDisplayName || "Creator"} is live on ${event.platform}.`,
      severity: "info",
      platform: event.platform,
      source_type: "live",
      source_key: `${event.platform}:${targetSourceKey || "unknown"}:${sessionKey}`,
      metadata_json: {
        session_key: sessionKey,
        source_key: targetSourceKey,
        title: dispatchPayload.title,
        category_name: dispatchPayload.categoryName,
      },
    });
  }

  await updateEventState(event.event_id, "processed");
  log("info", "fanout", `Processed event ${event.event_id} for ${enqueued} guild target(s)`);
}

async function handleProcessSocialEvent(job) {
  const payload = job.payload_json || {};
  const event = await getEventById(payload.eventId);

  if (!event) {
    throw new Error(`Event ${payload.eventId} was not found`);
  }

  if (event.processing_state === "processed") {
    return;
  }

  await updateEventState(event.event_id, "processing");

  const dispatchPayload = buildSocialEventDispatchPayload(event);
  const externalAccountId = dispatchPayload.external_account_id || event.payload_json?.candidate?.external_account_id || null;

  if (!externalAccountId || !event.source_external_id) {
    await updateEventState(event.event_id, "ignored");
    log("info", "fanout", `Ignored social event ${event.event_id}: missing account or post id`);
    return;
  }

  const targets = await getSocialEventTargets(event.platform, externalAccountId);
  const sessionKey = payload.sessionKey || `social:${event.platform}:${event.source_external_id}`;
  let enqueued = 0;

  for (const target of targets) {
    const entitlement = canRunPlatformForEntitlement(event.platform, target.entitlementStatus);
    if (!entitlement.allowed) {
      log(
        "warn",
        "social_feed",
        `Skipped guild ${target.guildId} for ${event.platform} social ${event.source_external_id}: ${entitlement.reason || "blocked"}`
      );
      continue;
    }

    await enqueueSocialFeedPostJob(
      {
        ...target,
        deliveryMode: entitlement.mode,
      },
      {
        eventId: event.event_id,
        platform: event.platform,
        eventType: event.event_type,
        sourceKey: event.source_key,
        sourceExternalId: event.source_external_id,
        sourceCreatedAt: event.source_created_at,
        sessionKey,
        payload: dispatchPayload,
      }
    );

    enqueued += 1;
  }

  await updateEventState(event.event_id, "processed");
  log("info", "social_feed", `Processed social event ${event.event_id} for ${enqueued} guild target(s)`);
}

async function handleDispatchLivePost(job) {
  const payload = job.payload_json || {};
  if (!payload.channelId) {
    throw new Error("Live-post job is missing a target channel.");
  }

  const begin = await beginLivePost(payload);
  if (begin.alreadyPosted) {
    log(
      "info",
      "live_post",
      `Skipped already-posted live session ${payload.sessionKey} for guild ${payload.guildId}`
    );
    return;
  }

  try {
    const config = getWorkerConfig();
    const discordBotToken = getDiscordBotTokenForLivePayload(payload, config);
    const discordPayload = buildLiveMessagePayload(payload);
    if (begin.resumePosting) {
      const recentMessages = await listChannelMessages(payload.channelId, discordBotToken, {
        apiBaseUrl: config.discordApiBaseUrl,
        maxRetries: config.discordMaxRetries,
        baseRetryMs: config.discordRetryBaseMs,
        limit: 25,
      }).catch((error) => {
        log(
          "warn",
          "live_post",
          `Recent-message reconciliation failed for guild ${payload.guildId}: ${error?.message || error}`
        );
        return [];
      });

      const existingMessage = Array.isArray(recentMessages)
        ? recentMessages.find((message) => doesMessageMatchPayload(message, discordPayload))
        : null;

      if (existingMessage?.id) {
        await markLivePostDelivered(payload, existingMessage);
        log(
          "info",
          "live_post",
          `Recovered existing live alert for guild ${payload.guildId} channel ${payload.channelId}`
        );
        return;
      }
    }

    const message = await sendChannelMessage(payload.channelId, discordBotToken, discordPayload, {
      apiBaseUrl: config.discordApiBaseUrl,
      maxRetries: config.discordMaxRetries,
      baseRetryMs: config.discordRetryBaseMs,
    });
    await markLivePostDelivered(payload, message);

    if (payload.autoStartThread && message?.id) {
      try {
        await createMessageThread(
          payload.channelId,
          message.id,
          discordBotToken,
          {
            name: buildAutoThreadName(payload),
            auto_archive_duration: 1440,
          },
          {
            apiBaseUrl: config.discordApiBaseUrl,
            maxRetries: config.discordMaxRetries,
            baseRetryMs: config.discordRetryBaseMs,
          }
        );
      } catch (error) {
        log(
          "warn",
          "live_post",
          `Thread creation failed for guild ${payload.guildId}: ${error?.message || error}`
        );
      }
    }

    log(
      "info",
      "live_post",
      `Posted live alert to guild ${payload.guildId} channel ${payload.channelId}`
    );
  } catch (error) {
    await markLivePostFailed(payload, error?.message || error);
    throw error;
  }
}

async function handleDispatchSocialFeedPost(job) {
  const payload = job.payload_json || {};
  if (!payload.channelId) {
    throw new Error("Social-feed job is missing a target channel.");
  }

  const begin = await beginSocialFeedPost(payload);
  if (begin.alreadyPosted) {
    log(
      "info",
      "social_feed",
      `Skipped already-posted social session ${payload.sessionKey} for guild ${payload.guildId}`
    );
    return;
  }

  try {
    const config = getWorkerConfig();
    const discordPayload = buildSocialFeedMessagePayload(payload);
    if (begin.resumePosting) {
      const recentMessages = await listChannelMessages(payload.channelId, config.discordBotToken, {
        apiBaseUrl: config.discordApiBaseUrl,
        maxRetries: config.discordMaxRetries,
        baseRetryMs: config.discordRetryBaseMs,
        limit: 25,
      }).catch((error) => {
        log(
          "warn",
          "social_feed",
          `Recent-message reconciliation failed for guild ${payload.guildId}: ${error?.message || error}`
        );
        return [];
      });

      const existingMessage = Array.isArray(recentMessages)
        ? recentMessages.find((message) => doesMessageMatchPayload(message, discordPayload))
        : null;

      if (existingMessage?.id) {
        await markSocialFeedPostDelivered(payload, existingMessage);
        log(
          "info",
          "social_feed",
          `Recovered existing social feed post for guild ${payload.guildId} channel ${payload.channelId}`
        );
        return;
      }
    }

    const message = await sendChannelMessage(payload.channelId, config.discordBotToken, discordPayload, {
      apiBaseUrl: config.discordApiBaseUrl,
      maxRetries: config.discordMaxRetries,
      baseRetryMs: config.discordRetryBaseMs,
    });
    await markSocialFeedPostDelivered(payload, message);

    log(
      "info",
      "social_feed",
      `Posted social feed alert to guild ${payload.guildId} channel ${payload.channelId}`
    );
  } catch (error) {
    await markSocialFeedPostFailed(payload, error?.message || error);
    throw error;
  }
}

async function handleDispatchSocialPost(job) {
  const config = getWorkerConfig();
  const payload = job.payload_json || {};
  const dispatch = await getCreatorDispatch(payload.dispatchId);

  if (!dispatch) {
    throw new Error(`Dispatch ${payload.dispatchId} was not found`);
  }

  const targetPlatforms = Array.from(new Set(
    Array.isArray(dispatch.target_platforms_json)
      ? dispatch.target_platforms_json.map((platform) => String(platform || "").trim().toLowerCase()).filter(Boolean)
      : []
  ));
  const connections = await getCreatorConnections(dispatch.discord_user_id, targetPlatforms);
  const connectionMap = new Map(connections.map((item) => [item.platform, item]));
  const outcomes = {};
  let successCount = 0;
  let failedCount = 0;

  for (const platform of targetPlatforms) {
    const connection = connectionMap.get(platform);
    if (
      !connection?.external_account_id ||
      String(connection.status || "").trim().toLowerCase() !== "active"
    ) {
      outcomes[platform] = {
        status: "missing_connection",
      };
      continue;
    }

    if (platform === "facebook" && !isFacebookConnectionReady(connection)) {
      outcomes[platform] = {
        status: "missing_connection",
      };
      continue;
    }

    if (platform === "instagram" && !isInstagramConnectionReady(connection)) {
      outcomes[platform] = {
        status: "missing_connection",
      };
      continue;
    }

    try {
      outcomes[platform] = await processConnectedSocialPublication(config, dispatch, platform, connection);
      successCount += 1;
    } catch (error) {
      failedCount += 1;
      outcomes[platform] = {
        status: "publish_failed",
        account: connection.external_account_name || connection.external_account_id || null,
        error: error?.message || String(error),
      };
    }
  }

  const nextStatus = successCount === 0
    ? "failed"
    : failedCount === 0 && Object.values(outcomes).every((item) => item?.status && item.status !== "missing_connection")
      ? "completed"
      : "partial";

  await updateCreatorDispatch(dispatch.dispatch_id, nextStatus, {
    outcomes,
    placeholder: Object.values(outcomes).some((item) => item?.status === "recorded_placeholder"),
    providerFailures: failedCount,
    loopPreventionReady: successCount > 0,
  });

  const isScheduled = Boolean(dispatch.scheduled_at);
  const title = nextStatus === "failed"
    ? "Post failed"
    : isScheduled
      ? "Scheduled post published"
      : "Post sent";
  await recordAutomationActivityAndQueuePush(dispatch.discord_user_id, {
    event_type: nextStatus === "failed"
      ? "post.failed"
      : isScheduled
        ? "post.scheduled_published"
        : "post.sent",
    title,
    body: nextStatus === "failed"
      ? "No connected platform accepted this post."
      : `Posted to ${successCount} platform${successCount === 1 ? "" : "s"}.`,
    severity: nextStatus === "failed" ? "error" : nextStatus === "partial" ? "warning" : "info",
    dispatch_id: dispatch.dispatch_id,
    source_type: "dispatch_result",
    source_key: `${dispatch.dispatch_id}:${nextStatus}`,
    metadata_json: {
      outcomes,
      scheduled_at: dispatch.scheduled_at || null,
    },
  });

  for (const [platform, outcome] of Object.entries(outcomes)) {
    if (!outcome || !["publish_failed", "missing_connection"].includes(outcome.status)) {
      continue;
    }
    await recordAutomationActivityAndQueuePush(dispatch.discord_user_id, {
      event_type: outcome.status === "missing_connection" ? "post.retry_needed" : "post.failed",
      title: outcome.status === "missing_connection"
        ? `Connect ${platform} to finish posting`
        : `Post failed on ${platform}`,
      body: outcome.error || "WatchMe needs attention before this platform can post.",
      severity: outcome.status === "missing_connection" ? "warning" : "error",
      platform,
      dispatch_id: dispatch.dispatch_id,
      source_type: "dispatch_platform_result",
      source_key: `${dispatch.dispatch_id}:${platform}:${outcome.status}`,
      metadata_json: {
        outcome,
      },
    });
  }

  log("info", "social_post", `Processed social dispatch ${dispatch.dispatch_id} with status ${nextStatus}`);
}

async function handleDispatchMobilePush(job) {
  const config = getWorkerConfig();
  const payload = job.payload_json || {};
  const activity = await getAutomationActivity(payload.activityId);
  if (!activity) {
    return;
  }

  if (!isMobilePushConfigured(config)) {
    await markAutomationActivityPushStatus(activity.activity_id, "disabled");
    return;
  }

  const devices = await getActiveMobilePushDevices(activity.discord_user_id);
  if (!devices.length) {
    await markAutomationActivityPushStatus(activity.activity_id, "no_devices");
    return;
  }

  let sent = 0;
  for (const device of devices) {
    try {
      const response = await sendFirebaseMessage(config, buildPushMessage(activity, device));
      sent += 1;
      await recordMobilePushDelivery({
        activityId: activity.activity_id,
        deviceId: device.device_id,
        discordUserId: activity.discord_user_id,
        status: "sent",
        responseJson: response,
      });
    } catch (error) {
      await recordMobilePushDelivery({
        activityId: activity.activity_id,
        deviceId: device.device_id,
        discordUserId: activity.discord_user_id,
        status: "failed",
        errorText: error?.message || String(error),
      });
    }
  }

  await markAutomationActivityPushStatus(activity.activity_id, sent > 0 ? "sent" : "failed");
}

async function handleJob(job) {
  switch (job.job_type) {
    case JOB_TYPES.RENEW_PLATFORM_SUBSCRIPTION:
      return handleRenewPlatformSubscription(job);
    case JOB_TYPES.INGEST_PLATFORM_EVENT:
      return handleIngestPlatformEvent(job);
    case JOB_TYPES.PROCESS_LIVE_EVENT:
      return handleProcessLiveEvent(job);
    case JOB_TYPES.PROCESS_SOCIAL_EVENT:
      return handleProcessSocialEvent(job);
    case JOB_TYPES.DISPATCH_LIVE_POST:
      return handleDispatchLivePost(job);
    case JOB_TYPES.DISPATCH_SOCIAL_FEED_POST:
      return handleDispatchSocialFeedPost(job);
    case JOB_TYPES.DISPATCH_SOCIAL_POST:
      return handleDispatchSocialPost(job);
    case JOB_TYPES.DISPATCH_MOBILE_PUSH:
      return handleDispatchMobilePush(job);
    default:
      log("warn", "jobs", `No handler registered for ${job.job_type}`);
  }
}

module.exports = {
  buildLiveSocialDispatchPayload,
  handleJob,
};
