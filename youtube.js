const crypto = require("node:crypto");
const fs = require("node:fs");

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function getServiceAccount(config = {}) {
  if (config.firebaseServiceAccountJson) {
    return JSON.parse(config.firebaseServiceAccountJson);
  }

  if (config.firebaseServiceAccountPath) {
    return JSON.parse(fs.readFileSync(config.firebaseServiceAccountPath, "utf8"));
  }

  return null;
}

function getFirebaseProjectId(config = {}, serviceAccount = null) {
  return config.firebaseProjectId || serviceAccount?.project_id || "";
}

function isMobilePushConfigured(config = {}) {
  return Boolean(config.firebaseProjectId || config.firebaseServiceAccountJson || config.firebaseServiceAccountPath);
}

async function getAccessToken(config = {}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessTokenExpiresAt - 60 > nowSeconds) {
    return cachedAccessToken;
  }

  const serviceAccount = getServiceAccount(config);
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
    throw new Error("Firebase service account is not configured.");
  }

  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .sign(serviceAccount.private_key);
  const assertion = `${unsigned}.${base64Url(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || `Firebase auth failed: ${response.status}`);
  }

  cachedAccessToken = payload.access_token;
  cachedAccessTokenExpiresAt = nowSeconds + Number(payload.expires_in || 3600);
  return cachedAccessToken;
}

function buildPushMessage(activity = {}, device = {}) {
  return {
    token: device.push_token,
    notification: {
      title: activity.title || "WatchMe",
      body: activity.body || "Automation update",
    },
    data: {
      activity_id: String(activity.activity_id || ""),
      event_type: String(activity.event_type || ""),
      dispatch_id: String(activity.dispatch_id || ""),
      platform: String(activity.platform || ""),
    },
    android: {
      priority: "high",
      notification: {
        channel_id: "watchme_automation",
        click_action: "WATCHME_AUTOMATION_ACTIVITY",
      },
    },
  };
}

async function sendFirebaseMessage(config = {}, message = {}) {
  const serviceAccount = getServiceAccount(config);
  const projectId = getFirebaseProjectId(config, serviceAccount);
  if (!projectId) {
    throw new Error("FIREBASE_PROJECT_ID is required for mobile push.");
  }

  const accessToken = await getAccessToken(config);
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `Firebase send failed: ${response.status}`);
  }
  return payload;
}

module.exports = {
  buildPushMessage,
  isMobilePushConfigured,
  sendFirebaseMessage,
};
