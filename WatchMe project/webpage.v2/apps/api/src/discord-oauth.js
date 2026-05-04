import { randomBytes } from "node:crypto";

export function createDiscordOAuthState() {
  return randomBytes(24).toString("hex");
}

export function isAllowedOAuthHost(hostNoPort, extraHosts = []) {
  const host = String(hostNoPort || "").trim().toLowerCase();
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host === "watchme-bot.com" || host.endsWith(".watchme-bot.com")) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return extraHosts.includes(host);
}

export function resolveDiscordRedirectUri({
  forwardedHost = "",
  forwardedProto = "",
  hostHeader = "",
  redirectUriFallback = "",
  extraHosts = [],
} = {}) {
  const xfHost = String(forwardedHost || "").split(",")[0].trim();
  const xfProto = String(forwardedProto || "").split(",")[0].trim().toLowerCase();
  const rawHost = xfHost || String(hostHeader || "").split(",")[0].trim();
  if (!rawHost) return redirectUriFallback;

  const hostNoPort = rawHost.split(":")[0];
  if (!isAllowedOAuthHost(hostNoPort, extraHosts)) {
    return redirectUriFallback;
  }

  const proto =
    xfProto === "https" || xfProto === "http"
      ? xfProto
      : rawHost.includes("localhost") || rawHost.startsWith("127.") || /^192\.168\./.test(hostNoPort)
        ? "http"
        : "https";

  return `${proto}://${rawHost}/auth/discord/callback`;
}

export function getDiscordRedirectUri(req, options) {
  return resolveDiscordRedirectUri({
    forwardedHost: req.get("x-forwarded-host"),
    forwardedProto: req.get("x-forwarded-proto"),
    hostHeader: req.get("host"),
    redirectUriFallback: options.redirectUriFallback,
    extraHosts: options.extraHosts,
  });
}

export function buildDiscordAuthorizeUrl({
  clientId,
  redirectUri,
  oauthState,
  scope = "identify guilds",
} = {}) {
  const params = new URLSearchParams({
    client_id: String(clientId || "").trim(),
    redirect_uri: String(redirectUri || "").trim(),
    response_type: "code",
    scope,
    state: String(oauthState || "").trim(),
  });

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export async function exchangeDiscordCode({
  clientId,
  clientSecret,
  code,
  redirectUri,
  signal,
  fetchImpl = fetch,
} = {}) {
  const response = await fetchImpl("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
    signal,
  });

  const payload = await response.json();
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error_description || payload?.error || "Discord token exchange failed.");
  }

  return payload;
}

export async function fetchDiscordIdentityBundle(accessToken, { signal, fetchImpl = fetch } = {}) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const [userResponse, guildsResponse] = await Promise.all([
    fetchImpl("https://discord.com/api/users/@me", { headers, signal }),
    fetchImpl("https://discord.com/api/users/@me/guilds", { headers, signal }),
  ]);

  if (!userResponse.ok) {
    throw new Error("Failed to load Discord user profile.");
  }

  const user = await userResponse.json();
  const guilds = guildsResponse.ok ? await guildsResponse.json() : [];

  return {
    user,
    guilds: Array.isArray(guilds) ? guilds : [],
  };
}

