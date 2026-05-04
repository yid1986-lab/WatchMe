import express from "express";
import session from "express-session";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createAuthRouter } from "./auth-router.js";
import { apiConfig } from "./config.js";
import { resolveEntitlement } from "./entitlement-service.js";
import {
  getProV2Guilds,
  getProV2AutomationActivity,
  getProV2AutomationHome,
  getProV2AutomationScheduled,
  getProV2Me,
  getProV2ScheduledPosts,
  getProV2SocialConnections,
  getProV2Templates,
  getProV2Workspace,
  getProV2GuildChannels,
  getProV2KeywordFilters,
  addProV2KeywordFilter,
  deleteProV2KeywordFilter,
  disconnectProV2Social,
  saveProV2GuildConfig,
  saveProV2ScheduledPost,
  saveProV2Template,
  selectProV2SocialPage,
  startProV2SocialOAuth,
} from "./pro-v2-client.js";

const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));
const webDistDir = resolve(__dirname, "../../../dist/web");
const webIndexPath = resolve(webDistDir, "index.html");

app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(
  session({
    secret: apiConfig.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: apiConfig.sessionCookieSecure,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use("/auth", createAuthRouter());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "watchme-web-v2-api",
    env: apiConfig.env,
    port: apiConfig.port,
  });
});

app.get("/api/entitlement/example", (_req, res) => {
  res.json({
    lite: resolveEntitlement({ billingStatus: "none" }),
    pending: resolveEntitlement({ billingStatus: "APPROVAL_PENDING" }),
    active: resolveEntitlement({ billingStatus: "ACTIVE" }),
    tester: resolveEntitlement({ tester: true }),
  });
});

app.get("/api/session", (_req, res) => {
  res.json({
    loggedIn: false,
    user: null,
    entitlement: resolveEntitlement({ billingStatus: "none" }),
    note: "V2 session/auth shell is live. Discord login wiring is app first, browser second.",
  });
});

function requireSessionUser(req, res, next) {
  if (!req.session?.user?.id) {
    return res.status(401).json({ error: "Discord login required." });
  }
  return next();
}

async function requireProEntitlement(req, res, next) {
  try {
    const mePayload = await getProV2Me(req.session.user.id);
    req.proV2Me = mePayload;
    if (!mePayload?.entitlement?.active || mePayload?.entitlement?.tier !== "pro") {
      return res.status(402).json({
        error: "Pro entitlement required.",
        entitlement: mePayload?.entitlement || resolveEntitlement({ billingStatus: "none" }),
      });
    }
    return next();
  } catch (error) {
    return res.status(502).json({
      error: error instanceof Error ? error.message : "Failed to verify Pro V2 entitlement.",
    });
  }
}

app.get("/api/me", requireSessionUser, async (req, res) => {
  try {
    const payload = await getProV2Me(req.session.user.id);
    res.json(payload);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to load member profile." });
  }
});

app.get("/api/guilds", requireSessionUser, async (req, res) => {
  try {
    const payload = await getProV2Guilds(req.session.user.id);
    res.json(payload);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to load guilds." });
  }
});

app.get("/api/workspace", requireSessionUser, requireProEntitlement, async (req, res) => {
  const guildId = String(req.query.guild_id || "").trim();
  if (!guildId) {
    return res.status(400).json({ error: "guild_id is required." });
  }

  try {
    const payload = await getProV2Workspace(req.session.user.id, guildId);
    res.json(payload);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to load workspace." });
  }
});

app.get("/api/workspace/channels", requireSessionUser, requireProEntitlement, async (req, res) => {
  const guildId = String(req.query.guild_id || "").trim();
  if (!guildId) {
    return res.status(400).json({ error: "guild_id is required." });
  }

  try {
    const payload = await getProV2GuildChannels(req.session.user.id, guildId);
    res.json(payload);
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : "Failed to load guild channels.",
    });
  }
});

app.get("/api/workspace/keyword-filters", requireSessionUser, requireProEntitlement, async (req, res) => {
  const guildId = String(req.query.guild_id || "").trim();
  if (!guildId) {
    return res.status(400).json({ error: "guild_id is required." });
  }

  try {
    const payload = await getProV2KeywordFilters(req.session.user.id, guildId);
    res.json(payload);
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : "Failed to load keyword filters.",
    });
  }
});

app.post("/api/workspace/keyword-filters", requireSessionUser, requireProEntitlement, async (req, res) => {
  const guildId = String(req.body?.guild_id || req.query.guild_id || "").trim();
  if (!guildId) {
    return res.status(400).json({ error: "guild_id is required." });
  }

  try {
    const payload = await addProV2KeywordFilter(req.session.user.id, guildId, req.body || {});
    res.json(payload);
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : "Failed to add keyword filter.",
    });
  }
});

app.delete("/api/workspace/keyword-filters", requireSessionUser, requireProEntitlement, async (req, res) => {
  const guildId = String(req.body?.guild_id || req.query.guild_id || "").trim();
  if (!guildId) {
    return res.status(400).json({ error: "guild_id is required." });
  }

  try {
    const payload = await deleteProV2KeywordFilter(req.session.user.id, guildId, req.body || {});
    res.json(payload);
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : "Failed to remove keyword filter.",
    });
  }
});

app.get("/api/templates", requireSessionUser, requireProEntitlement, async (req, res) => {
  try {
    const payload = await getProV2Templates(req.session.user.id);
    res.json(payload);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to load templates." });
  }
});

app.get("/api/social/connections", requireSessionUser, requireProEntitlement, async (req, res) => {
  try {
    const payload = await getProV2SocialConnections(req.session.user.id);
    res.json(payload);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to load social connections." });
  }
});

app.post("/api/social/oauth/start", requireSessionUser, requireProEntitlement, async (req, res) => {
  try {
    const payload = await startProV2SocialOAuth(req.session.user.id, String(req.body?.platform || ""));
    res.json(payload);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to start social OAuth." });
  }
});

app.delete("/api/social/connections/:platform", requireSessionUser, requireProEntitlement, async (req, res) => {
  try {
    const payload = await disconnectProV2Social(req.session.user.id, req.params.platform);
    res.json(payload);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to disconnect social account." });
  }
});

app.post("/api/social/connections/:platform/select-page", requireSessionUser, requireProEntitlement, async (req, res) => {
  try {
    const payload = await selectProV2SocialPage(req.session.user.id, req.params.platform, String(req.body?.page_id || ""));
    res.json(payload);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to save social Page selection." });
  }
});

app.get("/api/automation/home", requireSessionUser, requireProEntitlement, async (req, res) => {
  try {
    const payload = await getProV2AutomationHome(req.session.user.id);
    res.json(payload);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to load automation home." });
  }
});

app.get("/api/automation/activity", requireSessionUser, requireProEntitlement, async (req, res) => {
  try {
    const payload = await getProV2AutomationActivity(req.session.user.id, req.query.limit || 50);
    res.json(payload);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to load automation activity." });
  }
});

app.get("/api/automation/scheduled", requireSessionUser, requireProEntitlement, async (req, res) => {
  try {
    const payload = await getProV2AutomationScheduled(req.session.user.id);
    res.json(payload);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to load scheduled posts." });
  }
});

app.post("/api/templates", requireSessionUser, requireProEntitlement, async (req, res) => {
  try {
    const payload = await saveProV2Template(req.session.user.id, req.body || {});
    res.json(payload);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to save template." });
  }
});

app.get("/api/scheduled-posts", requireSessionUser, requireProEntitlement, async (req, res) => {
  const guildId = String(req.query.guild_id || "").trim();
  if (!guildId) {
    return res.status(400).json({ error: "guild_id is required." });
  }

  try {
    const payload = await getProV2ScheduledPosts(req.session.user.id, guildId);
    res.json(payload);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to load scheduled posts." });
  }
});

app.post("/api/scheduled-posts", requireSessionUser, requireProEntitlement, async (req, res) => {
  const guildId = String(req.body?.guild_id || req.query.guild_id || "").trim();
  if (!guildId) {
    return res.status(400).json({ error: "guild_id is required." });
  }

  try {
    const payload = await saveProV2ScheduledPost(req.session.user.id, guildId, req.body || {});
    res.json(payload);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to save scheduled post." });
  }
});

app.put("/api/workspace/config", requireSessionUser, requireProEntitlement, async (req, res) => {
  const guildId = String(req.body?.guild_id || req.query.guild_id || "").trim();
  if (!guildId) {
    return res.status(400).json({ error: "guild_id is required." });
  }

  try {
    const payload = await saveProV2GuildConfig(req.session.user.id, guildId, req.body || {});
    res.json(payload);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to save workspace config." });
  }
});

app.use(express.static(webDistDir));
app.get(/^(?!\/api\/|\/auth\/).*/, (_req, res) => {
  res.sendFile(webIndexPath);
});

app.listen(apiConfig.port, "0.0.0.0", () => {
  console.log(`[watchme-web-v2-api] listening on http://127.0.0.1:${apiConfig.port}`);
});
