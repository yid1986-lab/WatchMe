const { cleanText } = require("./utils");

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => cleanText(item))
        .filter(Boolean)
    )
  );
}

function getObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeHandle(username) {
  const next = cleanText(username);
  if (!next) {
    return null;
  }

  return `@${next.replace(/^@+/, "")}`;
}

function buildInstagramProfileUrl(username) {
  const next = cleanText(username);
  if (!next) {
    return null;
  }

  const normalized = next.replace(/^@+/, "");
  return normalized ? `https://instagram.com/${normalized}` : null;
}

function collectInstagramMediaUrls(media = {}, body = {}) {
  const children = Array.isArray(media.children) ? media.children : [];

  return Array.from(
    new Set(
      [
        body.media_url,
        body.thumbnail_url,
        media.media_url,
        media.thumbnail_url,
        ...(Array.isArray(body.media_urls_json) ? body.media_urls_json : []),
        ...(Array.isArray(media.media_urls) ? media.media_urls : []),
        ...children.flatMap((child) => {
          const next = getObject(child);
          return [next.media_url, next.thumbnail_url];
        }),
      ]
        .map((value) => cleanText(value))
        .filter(Boolean)
    )
  );
}

function inferInstagramContentType(mediaType, mediaProductType) {
  const normalizedMediaType = cleanText(mediaType)?.toUpperCase() || null;
  const normalizedProductType = cleanText(mediaProductType)?.toUpperCase() || null;

  if (normalizedProductType === "REELS") {
    return {
      contentType: "reel",
      contentLabel: "Reel",
    };
  }

  if (normalizedMediaType === "CAROUSEL_ALBUM") {
    return {
      contentType: "carousel",
      contentLabel: "Carousel",
    };
  }

  if (normalizedMediaType === "VIDEO") {
    return {
      contentType: "video",
      contentLabel: "Video",
    };
  }

  if (normalizedMediaType === "IMAGE") {
    return {
      contentType: "image",
      contentLabel: "Image",
    };
  }

  return {
    contentType: "post",
    contentLabel: "Post",
  };
}

function buildInstagramAdapterMetadata(body = {}, media = {}, username = null) {
  const metadata = typeof body.metadata_json === "object" && body.metadata_json !== null
    ? { ...body.metadata_json }
    : {};
  const mediaType = cleanText(body.media_type) || cleanText(media.media_type);
  const mediaProductType = cleanText(body.media_product_type) || cleanText(media.media_product_type);
  const content = inferInstagramContentType(mediaType, mediaProductType);

  return {
    ...metadata,
    provider: "instagram_graph",
    adapter: "instagram_media",
    username: cleanText(username) || metadata.username || null,
    media_type: mediaType,
    media_product_type: mediaProductType,
    content_type: content.contentType,
    content_label: content.contentLabel,
  };
}

function normalizeInstagramMediaAdapterBody(body = {}) {
  const media = getObject(body.media_item || body.media || body.post);
  const externalAccountId = cleanText(
    body.external_account_id ||
    body.account_id ||
    body.instagram_account_id ||
    body.user_id
  );
  const username = cleanText(body.username || media.username || body.account_username);
  const externalAccountName = cleanText(
    body.external_account_name ||
    body.account_name ||
    username ||
    media.username
  );
  const externalPostId = cleanText(body.external_post_id || media.id);
  const externalPostUrl = cleanText(body.external_post_url || media.permalink);
  const normalizedUrls = Array.from(
    new Set(
      [
        ...(Array.isArray(body.normalized_urls) ? body.normalized_urls : []),
        externalPostUrl,
      ]
        .map((value) => cleanText(value))
        .filter(Boolean)
    )
  );
  const mediaUrls = collectInstagramMediaUrls(media, body);
  const sourceUrl =
    cleanText(body.source_url) ||
    cleanText(body.external_account_url) ||
    buildInstagramProfileUrl(username);
  const mediaType = cleanText(body.media_type) || cleanText(media.media_type);
  const mediaProductType = cleanText(body.media_product_type) || cleanText(media.media_product_type);
  const content = inferInstagramContentType(mediaType, mediaProductType);

  if (!externalAccountId) {
    throw new Error("external_account_id, account_id, or instagram_account_id is required");
  }

  if (!externalPostId) {
    throw new Error("media.id or external_post_id is required");
  }

  return {
    platform: "instagram",
    external_account_id: externalAccountId,
    external_account_name: externalAccountName,
    external_account_url: cleanText(body.external_account_url) || buildInstagramProfileUrl(username),
    external_account_handle: normalizeHandle(username),
    external_app_id: cleanText(body.external_app_id || body.app_id || media.app_id),
    external_post_id: externalPostId,
    external_post_url: externalPostUrl,
    source_url: sourceUrl,
    normalized_text: cleanText(body.normalized_text || body.caption || media.caption),
    normalized_urls: normalizedUrls,
    media_urls_json: mediaUrls,
    published_at: cleanText(body.published_at || media.timestamp || body.source_created_at),
    source_created_at: cleanText(body.source_created_at || body.published_at || media.timestamp),
    provider_event_id: cleanText(body.provider_event_id) || `instagram:${externalAccountId}:${externalPostId}`,
    event_type: cleanText(body.event_type) || "social.post.created",
    processing_state: cleanText(body.processing_state) || "received",
    ingested_via: cleanText(body.ingested_via) || "instagram_inbound_adapter",
    metadata_json: buildInstagramAdapterMetadata(body, media, username),
    media_type: mediaType,
    media_product_type: mediaProductType,
    content_type: content.contentType,
    content_label: content.contentLabel,
    marker_strings: normalizeStringArray(body.marker_strings),
    related_post_ids: normalizeStringArray(body.related_post_ids),
    origin_keys: normalizeStringArray(body.origin_keys),
    origin_fingerprints: normalizeStringArray(body.origin_fingerprints),
  };
}

module.exports = {
  buildInstagramProfileUrl,
  inferInstagramContentType,
  normalizeInstagramMediaAdapterBody,
};
