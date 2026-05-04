import { Router } from "express";

import { apiConfig } from "./config.js";
import {
  buildDiscordAuthorizeUrl,
  createDiscordOAuthState,
  exchangeDiscordCode,
  fetchDiscordIdentityBundle,
  getDiscordRedirectUri,
} from "./discord-oauth.js";
import { resolveEntitlement } from "./entitlement-service.js";
import { getProV2Guilds, getProV2Me, syncDiscordWorkspaceToProV2 } from "./pro-v2-client.js";

const ALLOWED_RETURN_PAGES = new Set(["home", "billing", "dashboard"]);

function getPublicRedirect(page = "home") {
  const safePage = ALLOWED_RETURN_PAGES.has(String(page || "").trim()) ? page : "home";
  return `${apiConfig.publicOrigin}/#${safePage}`;
}

async function buildSessionPayload(req) {
  if (!req.session?.user) {
    return {
      loggedIn: false,
      user: null,
      guilds: [],
      entitlement: resolveEntitlement({ billingStatus: "none" }),
    };
  }

  try {
    const [mePayload, guildsPayload] = await Promise.all([
      getProV2Me(req.session.user.id),
      getProV2Guilds(req.session.user.id),
    ]);

    return {
      loggedIn: true,
      user: req.session.user,
      guilds: Array.isArray(guildsPayload?.guilds) ? guildsPayload.guilds : [],
      entitlement: mePayload?.entitlement || resolveEntitlement({ billingStatus: req.session?.billingStatus || "none" }),
      me: mePayload,
    };
  } catch (error) {
    return {
      loggedIn: true,
      user: req.session.user,
      guilds: Array.isArray(req.session?.guilds) ? req.session.guilds : [],
      entitlement: resolveEntitlement({
        billingStatus: req.session?.billingStatus || "none",
        tester: Boolean(req.session?.testerAccess),
        manualPro: Boolean(req.session?.manualProAccess),
      }),
      bootstrapError: error instanceof Error ? error.message : "Failed to load Pro V2 session payload.",
    };
  }
}

export function createAuthRouter() {
  const router = Router();

  router.get("/discord/login", (req, res) => {
    if (!apiConfig.discordClientId) {
      return res.status(500).json({ error: "Missing WEB_V2_DISCORD_CLIENT_ID." });
    }

    const requestedPage = String(req.query.state || "home").trim();
    const returnPage = ALLOWED_RETURN_PAGES.has(requestedPage) ? requestedPage : "home";
    const redirectUri = getDiscordRedirectUri(req, {
      redirectUriFallback: apiConfig.discordRedirectUriFallback,
      extraHosts: apiConfig.discordExtraHosts,
    });

    if (!redirectUri) {
      return res.status(500).json({ error: "Missing Discord redirect URI for V2 OAuth." });
    }

    const oauthState = createDiscordOAuthState();
    req.session.oauthState = oauthState;
    req.session.oauthReturnPage = returnPage;
    req.session.oauthRedirectUri = redirectUri;

    const authUrl = buildDiscordAuthorizeUrl({
      clientId: apiConfig.discordClientId,
      redirectUri,
      oauthState,
    });

    req.session.save((error) => {
      if (error) {
        console.error("[watchme-web-v2] failed to save OAuth session", error);
        return res.status(500).json({ error: "Failed to start Discord login." });
      }

      return res.redirect(authUrl);
    });
  });

  router.get("/discord/callback", async (req, res) => {
    const code = String(req.query.code || "").trim();
    const state = String(req.query.state || "").trim();
    const expectedState = String(req.session?.oauthState || "").trim();
    const returnPage = String(req.session?.oauthReturnPage || "home").trim();
    const redirectUri =
      String(req.session?.oauthRedirectUri || "").trim() ||
      getDiscordRedirectUri(req, {
        redirectUriFallback: apiConfig.discordRedirectUriFallback,
        extraHosts: apiConfig.discordExtraHosts,
      });

    if (!code || !state || !expectedState || state !== expectedState) {
      return res.redirect(getPublicRedirect("home"));
    }

    if (!apiConfig.discordClientId || !apiConfig.discordClientSecret || !redirectUri) {
      return res.redirect(getPublicRedirect("home"));
    }

    const abortController = new AbortController();
    const abortTimer = setTimeout(() => abortController.abort(), apiConfig.discordOauthTimeoutMs);

    try {
      const tokenPayload = await exchangeDiscordCode({
        clientId: apiConfig.discordClientId,
        clientSecret: apiConfig.discordClientSecret,
        code,
        redirectUri,
        signal: abortController.signal,
      });

      const identity = await fetchDiscordIdentityBundle(tokenPayload.access_token, {
        signal: abortController.signal,
      });

      await syncDiscordWorkspaceToProV2({
        user: identity.user,
        guilds: identity.guilds,
      });

      req.session.user = identity.user;
      req.session.guilds = identity.guilds;
      req.session.accessToken = tokenPayload.access_token;
      req.session.billingStatus = req.session.billingStatus || "none";
      delete req.session.oauthState;
      delete req.session.oauthReturnPage;
      delete req.session.oauthRedirectUri;

      req.session.save((error) => {
        if (error) {
          console.error("[watchme-web-v2] failed to persist Discord callback session", error);
          return res.redirect(getPublicRedirect("home"));
        }

        return res.redirect(getPublicRedirect(returnPage));
      });
    } catch (error) {
      console.error("[watchme-web-v2] Discord callback failed", error);
      return res.redirect(getPublicRedirect("home"));
    } finally {
      clearTimeout(abortTimer);
    }
  });

  router.get("/logout", (req, res) => {
    req.session.destroy(() => {
      res.redirect(getPublicRedirect("home"));
    });
  });

  router.get("/session", (req, res) => {
    if (!req.session?.user) {
      return res.status(401).json({ loggedIn: false, entitlement: resolveEntitlement({ billingStatus: "none" }) });
    }

    return buildSessionPayload(req)
      .then((payload) => res.json(payload))
      .catch((error) =>
        res.status(500).json({
          loggedIn: true,
          user: req.session.user,
          guilds: Array.isArray(req.session?.guilds) ? req.session.guilds : [],
          entitlement: resolveEntitlement({ billingStatus: req.session?.billingStatus || "none" }),
          bootstrapError: error instanceof Error ? error.message : "Failed to load session.",
        })
      );
  });

  return router;
}
