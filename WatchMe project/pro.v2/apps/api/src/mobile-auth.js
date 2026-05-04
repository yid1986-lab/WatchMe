const crypto = require("node:crypto");

const MOBILE_SESSION_AUDIENCE = "watchme-mobile-v1";
const MOBILE_AUTH_BEARER_PREFIX = "bearer ";
const MOBILE_SESSION_MAX_TTL_SECONDS = 30 * 24 * 60 * 60;

function getMobileSessionExpiryGraceSeconds() {
  const raw = Number(process.env.MOBILE_SESSION_EXPIRY_GRACE_SECONDS || 0);
  return Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64").toString("utf8");
}

function signMobileSessionPayload(encodedPayload, secret) {
  return base64UrlEncode(crypto.createHmac("sha256", secret).update(encodedPayload).digest());
}

function buildMobileSessionPayload({ discordUserId, expiresAtSeconds, issuedAtSeconds }) {
  return {
    aud: MOBILE_SESSION_AUDIENCE,
    sub: String(discordUserId || ""),
    exp: Number(expiresAtSeconds),
    iat: Number(issuedAtSeconds),
  };
}

function createMobileSessionToken({
  discordUserId,
  secret,
  expiresAtSeconds,
  issuedAtSeconds = Math.floor(Date.now() / 1000),
}) {
  if (!discordUserId) {
    throw new Error("discordUserId is required");
  }
  if (!secret) {
    throw new Error("secret is required");
  }

  const payload = buildMobileSessionPayload({
    discordUserId,
    expiresAtSeconds,
    issuedAtSeconds,
  });
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signMobileSessionPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

function issueMobileSession({
  discordUserId,
  secret,
  ttlSeconds = 3600,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const safeTtlSeconds = Math.max(60, Math.min(MOBILE_SESSION_MAX_TTL_SECONDS, Number(ttlSeconds || 0) || 3600));
  const issuedAtSeconds = Math.floor(nowSeconds);
  const expiresAtSeconds = issuedAtSeconds + safeTtlSeconds;
  const token = createMobileSessionToken({
    discordUserId,
    secret,
    expiresAtSeconds,
    issuedAtSeconds,
  });

  return {
    discordUserId: String(discordUserId),
    token,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    expiresAtSeconds,
    expiresInSeconds: safeTtlSeconds,
    issuedAt: new Date(issuedAtSeconds * 1000).toISOString(),
  };
}

function getMobileSessionToken(req) {
  const authorization = String(req?.headers?.authorization || "").trim();
  if (authorization.toLowerCase().startsWith(MOBILE_AUTH_BEARER_PREFIX)) {
    return authorization.slice(MOBILE_AUTH_BEARER_PREFIX.length).trim();
  }
  return String(req?.headers?.["x-mobile-session"] || req?.headers?.["x-mobile-auth-token"] || "").trim();
}

function verifyMobileSessionToken(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!token || !secret) {
    return { ok: false, code: "missing" };
  }

  const parts = String(token).split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, code: "malformed" };
  }

  const [encodedPayload, signature] = parts;
  const expectedSignature = signMobileSessionPayload(encodedPayload, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return { ok: false, code: "invalid_signature" };
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch (error) {
    return { ok: false, code: "invalid_payload" };
  }

  if (payload.aud !== MOBILE_SESSION_AUDIENCE) {
    return { ok: false, code: "invalid_audience" };
  }

  const discordUserId = String(payload.sub || "");
  const expiresAtSeconds = Number(payload.exp);
  if (!discordUserId || !Number.isFinite(expiresAtSeconds)) {
    return { ok: false, code: "invalid_claims" };
  }

  const expiryGraceSeconds = getMobileSessionExpiryGraceSeconds();
  if (expiresAtSeconds + expiryGraceSeconds <= Number(nowSeconds)) {
    return { ok: false, code: "expired" };
  }

  return {
    ok: true,
    discordUserId,
    expiresAtSeconds,
    issuedAtSeconds: Number(payload.iat || 0) || null,
  };
}

module.exports = {
  createMobileSessionToken,
  getMobileSessionToken,
  issueMobileSession,
  verifyMobileSessionToken,
};
