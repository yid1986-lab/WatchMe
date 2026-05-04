function getFacebookApiBaseUrl(config) {
  return String(config.facebookApiBaseUrl || "https://graph.facebook.com").trim();
}

function getFacebookGraphVersion(config) {
  return String(config.facebookGraphVersion || "v22.0").trim() || "v22.0";
}

function buildFacebookApiUrl(config, path) {
  const base = getFacebookApiBaseUrl(config).replace(/\/+$/, "");
  const version = getFacebookGraphVersion(config).replace(/^\/+|\/+$/g, "");
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  return `${base}/${version}/${normalizedPath}`;
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

function buildFacebookPostMessage(payload = {}) {
  const text = String(payload.post_text || "").trim();
  if (!text) {
    return "";
  }

  return text.slice(0, 6000);
}

function buildFacebookPostLink(payload = {}) {
  const raw = String(payload.link_url || "").trim();
  return raw || null;
}

function getFacebookConnectionAppId(config, connection = {}) {
  const metadata = connection.metadata_json || {};
  return String(metadata.app_id || metadata.appId || config.facebookAppId || "").trim() || null;
}

function isFacebookConnectionReady(connection = {}) {
  return Boolean(
    connection &&
      String(connection.status || "").trim().toLowerCase() === "active" &&
      connection.external_account_id &&
      connection.access_token
  );
}

async function publishFacebookPagePost(config, {
  pageId,
  pageToken,
  message,
  link = null,
}) {
  if (!pageId || !pageToken) {
    throw new Error("Facebook publish requires a page id and page access token.");
  }

  if (!String(message || "").trim() && !String(link || "").trim()) {
    throw new Error("Facebook publish needs post text or a link URL.");
  }

  const body = new URLSearchParams({
    access_token: String(pageToken),
  });

  if (String(message || "").trim()) {
    body.set("message", String(message).trim().slice(0, 6000));
  }

  if (String(link || "").trim()) {
    body.set("link", String(link).trim());
  }

  return requestJson(
    buildFacebookApiUrl(config, `${encodeURIComponent(String(pageId).trim())}/feed`),
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
  buildFacebookApiUrl,
  buildFacebookPostLink,
  buildFacebookPostMessage,
  getFacebookApiBaseUrl,
  getFacebookConnectionAppId,
  getFacebookGraphVersion,
  isFacebookConnectionReady,
  publishFacebookPagePost,
};
