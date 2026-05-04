function getInstagramApiBaseUrl(config) {
  return String(config.instagramApiBaseUrl || "https://graph.instagram.com").trim();
}

function getInstagramGraphVersion(config) {
  return String(config.instagramGraphVersion || "").trim();
}

function buildInstagramApiUrl(config, path) {
  const base = getInstagramApiBaseUrl(config).replace(/\/+$/, "");
  const version = getInstagramGraphVersion(config).replace(/^\/+|\/+$/g, "");
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  return version
    ? `${base}/${version}/${normalizedPath}`
    : `${base}/${normalizedPath}`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(10000),
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      data?.error ||
      `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return data;
}

function getInstagramConnectionAppId(config, connection = {}) {
  const metadata = connection.metadata_json || {};
  return String(metadata.app_id || metadata.appId || config.instagramAppId || "").trim() || null;
}

function isInstagramConnectionReady(connection = {}) {
  return Boolean(
    connection &&
      String(connection.status || "").trim().toLowerCase() === "active" &&
      connection.external_account_id &&
      connection.access_token
  );
}

function buildInstagramCaption(payload = {}) {
  const pieces = [
    String(payload.post_text || "").trim(),
    String(payload.link_url || "").trim(),
  ].filter(Boolean);

  return pieces.join("\n\n").slice(0, 2200);
}

function getInstagramPrimaryMediaUrl(payload = {}) {
  const mediaUrls = Array.isArray(payload.media_urls_json) ? payload.media_urls_json : [];
  for (const item of mediaUrls) {
    const value = String(item || "").trim();
    if (/^https?:\/\//i.test(value)) {
      return value;
    }
  }

  const fallback = String(payload?.metadata_json?.image_url || "").trim();
  if (/^https?:\/\//i.test(fallback)) {
    return fallback;
  }

  return null;
}

async function createInstagramMediaContainer(config, {
  accountId,
  accessToken,
  imageUrl,
  caption,
}) {
  if (!accountId || !accessToken || !imageUrl) {
    throw new Error("Instagram publish requires an account id, access token, and public image URL.");
  }

  const body = new URLSearchParams({
    access_token: String(accessToken),
    image_url: String(imageUrl),
  });

  if (String(caption || "").trim()) {
    body.set("caption", String(caption).trim().slice(0, 2200));
  }

  return requestJson(
    buildInstagramApiUrl(config, `${encodeURIComponent(String(accountId).trim())}/media`),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    }
  );
}

async function publishInstagramMedia(config, {
  accountId,
  accessToken,
  creationId,
}) {
  if (!accountId || !accessToken || !creationId) {
    throw new Error("Instagram media publish requires an account id, access token, and creation id.");
  }

  const body = new URLSearchParams({
    access_token: String(accessToken),
    creation_id: String(creationId),
  });

  return requestJson(
    buildInstagramApiUrl(config, `${encodeURIComponent(String(accountId).trim())}/media_publish`),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    }
  );
}

module.exports = {
  buildInstagramApiUrl,
  buildInstagramCaption,
  createInstagramMediaContainer,
  getInstagramApiBaseUrl,
  getInstagramConnectionAppId,
  getInstagramGraphVersion,
  getInstagramPrimaryMediaUrl,
  isInstagramConnectionReady,
  publishInstagramMedia,
};
