import { useEffect, useState } from "react";

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return payload;
}

async function loadSession() {
  try {
    return await requestJson("/auth/session");
  } catch {
    return {
      loggedIn: false,
      user: null,
      guilds: [],
      entitlement: {
        tier: "lite",
        active: false,
        status: "NONE",
        source: "none",
        reason: "not-pro",
      },
    };
  }
}

function getDiscordLoginHref(state = "home") {
  const params = new URLSearchParams({ state });
  return `/auth/discord/login?${params.toString()}`;
}

function beginDiscordAppFirstLogin(state = "home") {
  const browserHref = getDiscordLoginHref(state);
  if (typeof window === "undefined") {
    return browserHref;
  }

  let warmupFrame = null;
  try {
    warmupFrame = document.createElement("iframe");
    warmupFrame.setAttribute("aria-hidden", "true");
    warmupFrame.tabIndex = -1;
    warmupFrame.style.position = "absolute";
    warmupFrame.style.width = "0";
    warmupFrame.style.height = "0";
    warmupFrame.style.border = "0";
    warmupFrame.style.opacity = "0";
    warmupFrame.style.pointerEvents = "none";
    warmupFrame.src = "discord://-/channels/@me";
    document.body.appendChild(warmupFrame);
  } catch {}

  window.setTimeout(() => {
    try {
      warmupFrame?.remove();
    } catch {}
    window.location.assign(browserHref);
  }, 650);

  return browserHref;
}

const SOCIAL_PLATFORMS = ["facebook", "instagram", "tiktok", "x", "youtube"];

function platformName(platform) {
  return platform === "x" ? "X" : `${platform || ""}`.charAt(0).toUpperCase() + `${platform || ""}`.slice(1);
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function formatDateTime(value) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function getConnectionAvatar(connection) {
  return firstText(
    connection?.external_account_avatar_url,
    connection?.external_avatar_url,
    connection?.metadata_json?.avatar_url,
    connection?.metadata_json?.profile_image_url
  );
}

function SocialConnectionsPanel({ connections, onConnect, onDisconnect, onSelectPage }) {
  return (
    <section className="panel">
      <p className="panel-label">Social connections</p>
      <h2>Connected posting accounts</h2>
      <div className="social-list">
        {SOCIAL_PLATFORMS.map((platform) => {
          const connection = connections.find((item) => item.platform === platform);
          const pending = connection?.status === "pending_selection";
          const pageOptions = Array.isArray(connection?.metadata_json?.page_options)
            ? connection.metadata_json.page_options
            : [];
          const accountName = firstText(
            connection?.external_account_name,
            connection?.metadata_json?.display_name,
            connection?.external_account_id
          );
          const avatarUrl = getConnectionAvatar(connection);
          const statusText = pending ? "Needs page selection" : connection ? "Connected" : "Not connected";
          return (
            <article className="social-row" key={platform}>
              <div className="social-identity">
                {avatarUrl ? <img src={avatarUrl} alt="" className="social-avatar" /> : null}
                <div>
                  <strong>{platformName(platform)}</strong>
                  <p>{accountName || statusText}</p>
                </div>
              </div>
              <div className="social-meta">
                <span className={`status-badge ${connection ? (pending ? "status-pending" : "status-ok") : "status-idle"}`}>
                  {statusText}
                </span>
              </div>
              <div className="social-actions">
                {connection ? (
                  <button type="button" className="secondary-button" onClick={() => onDisconnect(platform)}>
                    Disconnect
                  </button>
                ) : (
                  <button type="button" className="primary-link button-reset" onClick={() => onConnect(platform)}>
                    Connect
                  </button>
                )}
              </div>
              {pending && pageOptions.length ? (
                <div className="page-picker">
                  {pageOptions.map((option) => (
                    <button
                      type="button"
                      className="secondary-button"
                      key={option.id}
                      onClick={() => onSelectPage(platform, option.id)}
                    >
                      {option.instagram_account_name
                        ? `${option.name} / ${option.instagram_account_name}`
                        : option.name || option.id}
                    </button>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function handleDiscordAppFirstLogin(event, state = "home") {
  event?.preventDefault?.();
  beginDiscordAppFirstLogin(state);
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function textValue(value) {
  return typeof value === "string" ? value : "";
}

function normalizeRouteRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      category: textValue(row?.category),
      role_id: textValue(row?.role_id),
      mention_mode: textValue(row?.mention_mode || "role") || "role",
    }))
    .filter((row) => row.category && row.role_id);
}

function parseRouteText(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [categoryPart, rolePart, mentionPart] = line.split("|").map((part) => part.trim());
      if (!categoryPart || !rolePart) {
        return null;
      }
      return {
        category: categoryPart,
        role_id: rolePart,
        mention_mode: mentionPart || "role",
      };
    })
    .filter(Boolean);
}

function formatRouteText(rows = []) {
  return normalizeRouteRows(rows)
    .map((row) => `${row.category} | ${row.role_id} | ${row.mention_mode || "role"}`)
    .join("\n");
}

function createEmptyTemplate() {
  return {
    name: "Post-stream recap",
    post_text: "We just wrapped up another live session. Catch the replay and follow the next alert from WatchMe.",
    link_url: "",
    target_platforms_json: ["facebook", "instagram"],
    media_urls_json: [],
    metadata_json: {
      event: "Live recap",
      track: "",
      car: "",
      game: "",
      guests: "",
    },
    is_default: false,
  };
}

function createConfigDraft(guildId = "") {
  return {
    guild_id: guildId,
    announce_channel_id: "",
    live_channel_id: "",
    socials_feed_channel_id: "",
    live_role_id: "",
    mention_mode: "role",
    brand_name: "",
    brand_logo_url: "",
    preview_image_url: "",
    footer_text: "",
    cooldown_seconds: 600,
    auto_cleanup: false,
    live_filter_games_json: [],
    live_filter_languages_json: [],
    live_filter_min_viewers: "",
    live_filter_max_viewers: "",
    category_role_routes_json: [],
    auto_start_thread: false,
    auto_start_thread_name: "{creator} live chat",
    stream_end_message_enabled: false,
    stream_end_message_template:
      "{creator} has wrapped up on {platform}. Keep an eye out for the next {category} session.",
  };
}

function entitlementSummary(entitlement) {
  if (!entitlement) return "Loading";
  return `${String(entitlement.tier || "lite").toUpperCase()} | ${entitlement.status || "NONE"} | ${entitlement.source || "none"}`;
}

function toDraftFromWorkspace(guildId, workspaceConfig = {}) {
  return {
    guild_id: guildId,
    announce_channel_id: textValue(workspaceConfig.announce_channel_id),
    live_channel_id: textValue(workspaceConfig.live_channel_id),
    socials_feed_channel_id: textValue(workspaceConfig.socials_feed_channel_id),
    live_role_id: textValue(workspaceConfig.live_role_id),
    mention_mode: textValue(workspaceConfig.mention_mode || "role") || "role",
    brand_name: textValue(workspaceConfig.brand_name),
    brand_logo_url: textValue(workspaceConfig.brand_logo_url),
    preview_image_url: textValue(workspaceConfig.preview_image_url),
    footer_text: textValue(workspaceConfig.footer_text),
    cooldown_seconds: Number(workspaceConfig.cooldown_seconds || 600),
    auto_cleanup: Boolean(workspaceConfig.auto_cleanup),
    live_filter_games_json: Array.isArray(workspaceConfig.live_filter_games_json)
      ? workspaceConfig.live_filter_games_json
      : [],
    live_filter_languages_json: Array.isArray(workspaceConfig.live_filter_languages_json)
      ? workspaceConfig.live_filter_languages_json
      : [],
    live_filter_min_viewers: workspaceConfig.live_filter_min_viewers ?? "",
    live_filter_max_viewers: workspaceConfig.live_filter_max_viewers ?? "",
    category_role_routes_json: normalizeRouteRows(workspaceConfig.category_role_routes_json),
    auto_start_thread: Boolean(workspaceConfig.auto_start_thread),
    auto_start_thread_name:
      textValue(workspaceConfig.auto_start_thread_name) || "{creator} live chat",
    stream_end_message_enabled: Boolean(workspaceConfig.stream_end_message_enabled),
    stream_end_message_template:
      textValue(workspaceConfig.stream_end_message_template) ||
      "{creator} has wrapped up on {platform}. Keep an eye out for the next {category} session.",
  };
}

function activityIdentity(item) {
  return firstText(
    item?.creator_name,
    item?.creator_display_name,
    item?.display_name,
    item?.metadata_json?.creator_name,
    item?.payload_json?.creator_name
  );
}

function creatorAvatar(creator) {
  return firstText(
    creator?.avatar_url,
    creator?.profile_image_url,
    creator?.discord_avatar_url,
    creator?.metadata_json?.avatar_url
  );
}

function creatorStatus(creator) {
  return firstText(creator?.access_status, creator?.status, "pending");
}

function supportsVideoUpload() {
  return false;
}

function AutomationControlTower({ home, activity, scheduled }) {
  const summary = home?.summary || {};
  const health = home?.health || {};
  return (
    <section className="panel">
      <p className="panel-label">Pro control tower</p>
      <h2>Stats overview</h2>
      <div className="stat-grid">
        <div className="stat-tile">
          <strong>{summary.creators_live ?? 0}</strong>
          <span>Creators live now</span>
        </div>
        <div className="stat-tile">
          <strong>{summary.posts_today ?? 0}</strong>
          <span>Posts in last 24h</span>
        </div>
        <div className="stat-tile">
          <strong>{summary.success_rate == null ? "--" : `${summary.success_rate}%`}</strong>
          <span>Delivery success</span>
        </div>
        <div className="stat-tile">
          <strong>{summary.needs_attention ?? 0}</strong>
          <span>Needs attention</span>
        </div>
      </div>
      <div className="grid">
        <article className="panel inset-panel">
          <p className="panel-label">Health</p>
          <p>Top platform: {summary.top_platform || "Waiting for posts"}</p>
          <p>Connected platforms: {health.connected_platforms ?? 0}/{health.total_platforms ?? 0}</p>
          <p>Push devices: {health.active_push_devices ?? 0}</p>
          <p>Scheduled posts: {summary.scheduled_count ?? 0}</p>
        </article>
        <article className="panel inset-panel">
          <p className="panel-label">Scheduled</p>
          {(scheduled || []).length ? (
            <div className="stack">
              {scheduled.slice(0, 5).map((post) => (
                <div key={post.dispatch_id}>
                  <strong>{post.payload_json?.template_name || `Dispatch ${post.dispatch_id}`}</strong>
                  <div>{formatDateTime(post.scheduled_at)} | {(post.target_platforms_json || []).join(", ")}</div>
                </div>
              ))}
            </div>
          ) : (
            <p>No scheduled posts queued.</p>
          )}
        </article>
      </div>
      <div className="stack">
        <p className="panel-label">Activity feed</p>
        {(activity || []).length ? (
          activity.slice(0, 10).map((item) => {
            const actor = activityIdentity(item);
            return (
              <div className="activity-row" key={item.activity_id}>
                <strong>{item.title}</strong>
                <span>{item.body || item.event_type}</span>
                <small>
                  {actor ? `${actor} | ` : ""}
                  {item.platform || "watchme"} | {formatDateTime(item.created_at)}
                </small>
              </div>
            );
          })
        ) : (
          <p>No automation activity yet.</p>
        )}
      </div>
    </section>
  );
}

function PublicLanding() {
  return (
    <main className="marketing-shell">
      <section className="marketing-hero">
        <nav className="marketing-nav" aria-label="WatchMe">
          <img src="/branding/watchme-pro-logo.png" alt="WatchMe Pro" className="brand-logo" />
          <a
            className="nav-login"
            href={getDiscordLoginHref("dashboard")}
            onClick={(event) => handleDiscordAppFirstLogin(event, "dashboard")}
          >
            Log in with Discord
          </a>
        </nav>

        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">WatchMe Pro</p>
            <h1>Automatic creator alerts for Discord and socials.</h1>
            <p className="lede">
              WatchMe detects when creators go live, posts the alert, tracks what happened, and keeps
              the control tower synced across web and mobile.
            </p>
            <div className="hero-actions">
              <a
                className="primary-link"
                href={getDiscordLoginHref("dashboard")}
                onClick={(event) => handleDiscordAppFirstLogin(event, "dashboard")}
              >
                Open Pro dashboard
              </a>
              <a className="secondary-link" href="/downloads/watchme-pro-latest.apk">
                Download Android app
              </a>
            </div>
          </div>

          <div className="control-preview" aria-label="WatchMe automation preview">
            <div className="preview-header">
              <img src="/branding/watchme-pro-logo.png" alt="" />
              <span>Live automation</span>
            </div>
            <div className="preview-stat-row">
              <div>
                <strong>2</strong>
                <span>Creators live</span>
              </div>
              <div>
                <strong>6</strong>
                <span>Posts sent today</span>
              </div>
              <div>
                <strong>100%</strong>
                <span>Success rate</span>
              </div>
            </div>
            <div className="preview-feed">
              <div><b>Live detected</b><span>SimFxRacing is live on Twitch</span></div>
              <div><b>Post sent</b><span>Discord, Facebook, and Instagram queued</span></div>
              <div><b>Loop blocked</b><span>WatchMe-generated social post ignored</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="feature-strip" aria-label="WatchMe Pro features">
        <article>
          <span>01</span>
          <h2>No-click live alerts</h2>
          <p>Creator goes live, WatchMe posts the Discord alert automatically.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Social automation</h2>
          <p>Scheduled and live posts distribute across connected social pages.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Control tower</h2>
          <p>See successes, failures, retries, schedules, and loop protection in one place.</p>
        </article>
      </section>
    </main>
  );
}

export function App() {
  const [health, setHealth] = useState(null);
  const [session, setSession] = useState(null);
  const [me, setMe] = useState(null);
  const [guilds, setGuilds] = useState([]);
  const [selectedGuildId, setSelectedGuildId] = useState("");
  const [workspace, setWorkspace] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [templateDraft, setTemplateDraft] = useState(createEmptyTemplate);
  const [configDraft, setConfigDraft] = useState(createConfigDraft);
  const [routeText, setRouteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [automationHome, setAutomationHome] = useState(null);
  const [automationActivity, setAutomationActivity] = useState([]);
  const [automationScheduled, setAutomationScheduled] = useState([]);
  const [socialConnections, setSocialConnections] = useState([]);
  const [socialRefreshTick, setSocialRefreshTick] = useState(0);
  const connectedGuilds = guilds.filter((guild) =>
    guild?.billing_connected === true
    || guild?.is_billing_connected === true
    || guild?.assigned === true
    || guild?.entitlement_active === true
  );
  const singleAssignedGuild = connectedGuilds.length === 1 ? connectedGuilds[0] : null;

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        const [healthPayload, sessionPayload] = await Promise.all([
          requestJson("/api/health"),
          loadSession(),
        ]);

        if (cancelled) return;
        setHealth(healthPayload);
        setSession(sessionPayload);

        if (!sessionPayload.loggedIn) {
          setMe(null);
          setGuilds([]);
          return;
        }

        const [mePayload, guildsPayload] = await Promise.all([
          requestJson("/api/me"),
          requestJson("/api/guilds"),
        ]);

        if (cancelled) return;
        setMe(mePayload);
        const nextGuilds = Array.isArray(guildsPayload.guilds) ? guildsPayload.guilds : [];
        setGuilds(nextGuilds);
        setSelectedGuildId((current) => current || nextGuilds[0]?.guild_id || "");
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load workspace bootstrap.");
        }
      }
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspace() {
      if (!session?.loggedIn || !me?.entitlement?.active || !selectedGuildId) {
        setWorkspace(null);
        setTemplates([]);
        setConfigDraft(createConfigDraft(selectedGuildId));
        setRouteText("");
        return;
      }

      try {
        const [workspacePayload, templatesPayload] = await Promise.all([
          requestJson(`/api/workspace?guild_id=${encodeURIComponent(selectedGuildId)}`),
          requestJson("/api/templates"),
        ]);

        if (cancelled) return;
        const nextWorkspace = workspacePayload.workspace || null;
        setWorkspace(nextWorkspace);
        setTemplates(Array.isArray(templatesPayload.templates) ? templatesPayload.templates : []);
        const nextDraft = toDraftFromWorkspace(selectedGuildId, nextWorkspace?.config || {});
        setConfigDraft(nextDraft);
        setRouteText(formatRouteText(nextDraft.category_role_routes_json));
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load selected workspace.");
        }
      }
    }

    loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [session?.loggedIn, me?.entitlement?.active, selectedGuildId]);

  useEffect(() => {
    let cancelled = false;

    async function loadAutomation() {
      if (!session?.loggedIn || !me?.entitlement?.active) {
        setAutomationHome(null);
        setAutomationActivity([]);
        setAutomationScheduled([]);
        setSocialConnections([]);
        return;
      }

      try {
        const [homePayload, activityPayload, scheduledPayload, socialPayload] = await Promise.all([
          requestJson("/api/automation/home"),
          requestJson("/api/automation/activity?limit=20"),
          requestJson("/api/automation/scheduled"),
          requestJson("/api/social/connections"),
        ]);

        if (cancelled) return;
        setAutomationHome(homePayload);
        setAutomationActivity(Array.isArray(activityPayload.items) ? activityPayload.items : []);
        setAutomationScheduled(Array.isArray(scheduledPayload.scheduled) ? scheduledPayload.scheduled : []);
        setSocialConnections(Array.isArray(socialPayload.connections) ? socialPayload.connections : []);
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load automation control tower.");
        }
      }
    }

    loadAutomation();
    return () => {
      cancelled = true;
    };
  }, [session?.loggedIn, me?.entitlement?.active, socialRefreshTick]);

  useEffect(() => {
    if (!singleAssignedGuild?.guild_id) return;
    setSelectedGuildId((current) => current || singleAssignedGuild.guild_id);
  }, [singleAssignedGuild?.guild_id]);

  async function refreshSocialConnections() {
    const socialPayload = await requestJson("/api/social/connections");
    setSocialConnections(Array.isArray(socialPayload.connections) ? socialPayload.connections : []);
  }

  async function connectSocial(platform) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const payload = await requestJson("/api/social/oauth/start", {
        method: "POST",
        body: JSON.stringify({ platform }),
      });
      if (!payload?.authorize_url) {
        throw new Error("No OAuth URL returned.");
      }
      window.location.assign(payload.authorize_url);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to start social OAuth.");
      setBusy(false);
    }
  }

  async function disconnectSocial(platform) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await requestJson(`/api/social/connections/${encodeURIComponent(platform)}`, { method: "DELETE" });
      await refreshSocialConnections();
      setSocialRefreshTick((value) => value + 1);
      setNotice(`${platformName(platform)} disconnected.`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to disconnect social account.");
    } finally {
      setBusy(false);
    }
  }

  async function selectSocialPage(platform, pageId) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await requestJson(`/api/social/connections/${encodeURIComponent(platform)}/select-page`, {
        method: "POST",
        body: JSON.stringify({ page_id: pageId }),
      });
      await refreshSocialConnections();
      setSocialRefreshTick((value) => value + 1);
      setNotice(`${platformName(platform)} Page connected.`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save Page selection.");
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const payload = await requestJson("/api/templates", {
        method: "POST",
        body: JSON.stringify(templateDraft),
      });
      setNotice(`Template saved: ${payload?.template?.name || "Unnamed template"}`);
      const templatesPayload = await requestJson("/api/templates");
      setTemplates(Array.isArray(templatesPayload.templates) ? templatesPayload.templates : []);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save template.");
    } finally {
      setBusy(false);
    }
  }

  async function saveConfig() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const payload = await requestJson("/api/workspace/config", {
        method: "PUT",
        body: JSON.stringify({
          ...configDraft,
          guild_id: selectedGuildId,
          category_role_routes_json: parseRouteText(routeText),
        }),
      });
      const savedConfig = payload?.config || configDraft;
      setWorkspace((current) => ({
        ...(current || {}),
        config: savedConfig,
        branding: {
          ...(current?.branding || {}),
          brand_name: savedConfig.brand_name || "",
          brand_logo_url: savedConfig.brand_logo_url || "",
          preview_image_url: savedConfig.preview_image_url || "",
          footer_text: savedConfig.footer_text || "",
        },
      }));
      const nextDraft = toDraftFromWorkspace(selectedGuildId, savedConfig);
      setConfigDraft(nextDraft);
      setRouteText(formatRouteText(nextDraft.category_role_routes_json));
      setNotice(`Live automation saved for guild ${selectedGuildId}.`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save workspace config.");
    } finally {
      setBusy(false);
    }
  }

  const creatorPerformance = workspace?.creator_performance || { summary: {}, top_creators: [] };
  const savedCreators = Array.isArray(workspace?.creators) ? workspace.creators : [];

  if (session && !session.loggedIn) {
    return <PublicLanding />;
  }

  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">WatchMe Pro</p>
        <h1>Stats and control tower</h1>
        <p className="lede">
          Manage live alerts, scheduled posts, creator routing, social distribution, and automation
          health from the same Pro workspace used by the mobile app.
        </p>
        <div className="hero-actions">
          <a
            className="primary-link"
            href={getDiscordLoginHref("dashboard")}
            onClick={(event) => handleDiscordAppFirstLogin(event, "dashboard")}
          >
            Log in with Discord
          </a>
          <p className="hint-text">Discord app first, browser second.</p>
        </div>
      </section>

      <section className="grid">
        <article className="panel">
          <p className="panel-label">Connection</p>
          <h2>{health?.ok ? "WatchMe services online" : "Checking services..."}</h2>
          <p>Dashboard and Pro automation APIs are connected.</p>
        </article>

        <article className="panel">
          <p className="panel-label">Session</p>
          <h2>{session?.loggedIn ? "Discord connected" : "Logged out"}</h2>
          <p>
            Member:{" "}
            <strong>
              {session?.user?.global_name || session?.user?.username || "No active user"}
            </strong>
          </p>
          <p>Entitlement: {entitlementSummary(me?.entitlement || session?.entitlement)}</p>
        </article>
      </section>

      {error ? (
        <section className="panel">
          <p className="panel-label">Error</p>
          <p className="error-text">{error}</p>
        </section>
      ) : null}

      {notice ? (
        <section className="panel">
          <p className="panel-label">Saved</p>
          <p>{notice}</p>
        </section>
      ) : null}

      {session?.loggedIn && me?.entitlement?.active ? (
        <>
          <AutomationControlTower
            home={automationHome}
            activity={automationActivity}
            scheduled={automationScheduled}
          />
          <SocialConnectionsPanel
            connections={socialConnections}
            onConnect={connectSocial}
            onDisconnect={disconnectSocial}
            onSelectPage={selectSocialPage}
          />
        </>
      ) : null}

      <section className="panel">
        <p className="panel-label">Workspace</p>
        {!session?.loggedIn ? (
          <p>Log in with Discord to build the WatchMe creator automation workspace.</p>
        ) : !me?.entitlement?.active ? (
          <div>
            <h2>Pro workspace locked</h2>
            <p>
              This account stays Lite until Pro V2 returns an active entitlement. WatchMe now gates the
              full creator automation workspace on Pro, not local preview state.
            </p>
            <pre>{prettyJson(me || session)}</pre>
          </div>
        ) : (
          <div className="stack">
            {singleAssignedGuild ? (
              <label className="field-stack">
                <span>Assigned server</span>
                <input
                  className="input-shell"
                  value={singleAssignedGuild.name || singleAssignedGuild.guild_id}
                  readOnly
                />
              </label>
            ) : (
              <label className="field-stack">
                <span>Manageable server</span>
                <select
                  value={selectedGuildId}
                  onChange={(event) => setSelectedGuildId(event.target.value)}
                  className="input-shell"
                >
                  <option value="">Select a server</option>
                  {guilds.map((guild) => (
                    <option key={guild.guild_id} value={guild.guild_id}>
                      {guild.name || guild.guild_id}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="grid">
              <article className="panel">
                <p className="panel-label">Creator performance (7 days)</p>
                <h2>{creatorPerformance.summary?.alert_count || 0} live alerts delivered</h2>
                <p>{creatorPerformance.summary?.creator_count || 0} creators reached this week</p>
                <p>Last live: {creatorPerformance.summary?.last_live_at || "No recent live data"}</p>
                <div className="stack">
                  {(creatorPerformance.top_creators || []).length ? (
                    creatorPerformance.top_creators.map((creator) => (
                      <div key={creator.discord_user_id} className="creator-card">
                        <strong>{creator.creator_name || creator.display_name || creator.discord_user_id}</strong>
                        <div className="muted-line">
                          {creator.alert_count} alerts | peak viewers {creator.peak_viewers || 0} |{" "}
                          {(creator.platforms || []).join(", ") || "No platforms yet"}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p>No creator live deliveries recorded yet.</p>
                  )}
                </div>
              </article>

              <article className="panel">
                <p className="panel-label">Saved creators</p>
                <h2>{savedCreators.length} creators linked</h2>
                <div className="stack">
                  {savedCreators.length ? (
                    savedCreators.map((creator) => (
                      <div key={`${creator.guild_id}-${creator.discord_user_id}`} className="creator-card">
                        <div className="creator-header">
                          {creatorAvatar(creator) ? (
                            <img src={creatorAvatar(creator)} alt="" className="creator-avatar" />
                          ) : null}
                          <div>
                            <strong>{creator.display_name || creator.creator_name || creator.discord_user_id}</strong>
                            <div className="muted-line">{creatorStatus(creator)}</div>
                          </div>
                        </div>
                        <div className="muted-line">
                          {[creator.twitch_url && "Twitch", creator.youtube_url && "YouTube", creator.kick_url && "Kick"]
                            .filter(Boolean)
                            .join(", ") || "No platforms yet"}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p>No creators linked for this server yet.</p>
                  )}
                </div>
              </article>
            </div>

            <article className="panel">
              <p className="panel-label">Live automation config</p>
              <div className="form-grid">
                <p className="hint-text">Brand images use temporary URL input until upload support is added.</p>
                <div className="grid compact-grid">
                  <input
                    value={configDraft.brand_name}
                    onChange={(event) =>
                      setConfigDraft((current) => ({ ...current, brand_name: event.target.value }))
                    }
                    placeholder="Server brand name"
                    className="input-shell"
                  />
                  <input
                    value={configDraft.footer_text}
                    onChange={(event) =>
                      setConfigDraft((current) => ({ ...current, footer_text: event.target.value }))
                    }
                    placeholder="Embed footer text"
                    className="input-shell"
                  />
                </div>
                <div className="grid compact-grid">
                  <input
                    value={configDraft.brand_logo_url}
                    onChange={(event) =>
                      setConfigDraft((current) => ({ ...current, brand_logo_url: event.target.value }))
                    }
                    placeholder="Temporary logo image URL"
                    className="input-shell"
                  />
                  <input
                    value={configDraft.preview_image_url}
                    onChange={(event) =>
                      setConfigDraft((current) => ({ ...current, preview_image_url: event.target.value }))
                    }
                    placeholder="Temporary fallback preview image URL"
                    className="input-shell"
                  />
                </div>
                <div className="grid compact-grid">
                  <div className="image-preview-shell">
                    <p className="panel-label">Logo preview</p>
                    {configDraft.brand_logo_url ? (
                      <img src={configDraft.brand_logo_url} alt="Brand logo preview" className="branding-preview-image" />
                    ) : (
                      <p className="muted-line">No logo URL set.</p>
                    )}
                  </div>
                  <div className="image-preview-shell">
                    <p className="panel-label">Fallback preview image</p>
                    {configDraft.preview_image_url ? (
                      <img src={configDraft.preview_image_url} alt="Fallback preview" className="branding-preview-image" />
                    ) : (
                      <p className="muted-line">No fallback image URL set.</p>
                    )}
                  </div>
                </div>
                <div className="grid compact-grid">
                  <input
                    value={configDraft.announce_channel_id}
                    onChange={(event) =>
                      setConfigDraft((current) => ({ ...current, announce_channel_id: event.target.value }))
                    }
                    placeholder="Announce channel ID"
                    className="input-shell"
                  />
                  <input
                    value={configDraft.live_channel_id}
                    onChange={(event) =>
                      setConfigDraft((current) => ({ ...current, live_channel_id: event.target.value }))
                    }
                    placeholder="Live channel ID"
                    className="input-shell"
                  />
                </div>
                <div className="grid compact-grid">
                  <input
                    value={configDraft.socials_feed_channel_id}
                    onChange={(event) =>
                      setConfigDraft((current) => ({
                        ...current,
                        socials_feed_channel_id: event.target.value,
                      }))
                    }
                    placeholder="Social feed channel ID"
                    className="input-shell"
                  />
                  <input
                    value={configDraft.live_role_id}
                    onChange={(event) =>
                      setConfigDraft((current) => ({ ...current, live_role_id: event.target.value }))
                    }
                    placeholder="Default live role ID"
                    className="input-shell"
                  />
                </div>
                <div className="grid compact-grid">
                  <select
                    value={configDraft.mention_mode}
                    onChange={(event) =>
                      setConfigDraft((current) => ({ ...current, mention_mode: event.target.value }))
                    }
                    className="input-shell"
                  >
                    <option value="role">Role mention</option>
                    <option value="member">Creator mention</option>
                    <option value="both">Role + creator</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    value={configDraft.cooldown_seconds}
                    onChange={(event) =>
                      setConfigDraft((current) => ({
                        ...current,
                        cooldown_seconds: Number(event.target.value || 0),
                      }))
                    }
                    placeholder="Cooldown seconds"
                    className="input-shell"
                  />
                </div>
                <textarea
                  value={configDraft.live_filter_games_json.join(", ")}
                  onChange={(event) =>
                    setConfigDraft((current) => ({
                      ...current,
                      live_filter_games_json: event.target.value
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    }))
                  }
                  placeholder="Allowed games/categories, comma separated"
                  rows={3}
                  className="textarea-shell"
                />
                <textarea
                  value={configDraft.live_filter_languages_json.join(", ")}
                  onChange={(event) =>
                    setConfigDraft((current) => ({
                      ...current,
                      live_filter_languages_json: event.target.value
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    }))
                  }
                  placeholder="Allowed stream languages, comma separated"
                  rows={3}
                  className="textarea-shell"
                />
                <div className="grid compact-grid">
                  <input
                    type="number"
                    min="0"
                    value={configDraft.live_filter_min_viewers}
                    onChange={(event) =>
                      setConfigDraft((current) => ({
                        ...current,
                        live_filter_min_viewers: event.target.value,
                      }))
                    }
                    placeholder="Minimum viewers"
                    className="input-shell"
                  />
                  <input
                    type="number"
                    min="0"
                    value={configDraft.live_filter_max_viewers}
                    onChange={(event) =>
                      setConfigDraft((current) => ({
                        ...current,
                        live_filter_max_viewers: event.target.value,
                      }))
                    }
                    placeholder="Maximum viewers"
                    className="input-shell"
                  />
                </div>
                <textarea
                  value={routeText}
                  onChange={(event) => setRouteText(event.target.value)}
                  placeholder={"Category | role_id | mention_mode\nEA FC | 123456789 | role"}
                  rows={4}
                  className="textarea-shell"
                />
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={configDraft.auto_start_thread}
                    onChange={(event) =>
                      setConfigDraft((current) => ({
                        ...current,
                        auto_start_thread: event.target.checked,
                      }))
                    }
                  />
                  <span>Auto-create a Discord thread for each live alert</span>
                </label>
                <input
                  value={configDraft.auto_start_thread_name}
                  onChange={(event) =>
                    setConfigDraft((current) => ({
                      ...current,
                      auto_start_thread_name: event.target.value,
                    }))
                  }
                  placeholder="Thread name template"
                  className="input-shell"
                />
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={configDraft.stream_end_message_enabled}
                    onChange={(event) =>
                      setConfigDraft((current) => ({
                        ...current,
                        stream_end_message_enabled: event.target.checked,
                      }))
                    }
                  />
                  <span>Send a stream-end follow-up when provider end events arrive</span>
                </label>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={configDraft.auto_cleanup}
                    onChange={(event) =>
                      setConfigDraft((current) => ({
                        ...current,
                        auto_cleanup: event.target.checked,
                      }))
                    }
                  />
                  <span>Remove the live alert when the stream ends</span>
                </label>
                <textarea
                  value={configDraft.stream_end_message_template}
                  onChange={(event) =>
                    setConfigDraft((current) => ({
                      ...current,
                      stream_end_message_template: event.target.value,
                    }))
                  }
                  placeholder="Follow-up template"
                  rows={3}
                  className="textarea-shell"
                />
                <button className="primary-link" onClick={saveConfig} disabled={busy || !selectedGuildId}>
                  Save live automation
                </button>
              </div>
            </article>

            <div className="grid">
              <article className="panel">
                <p className="panel-label">Workspace payload</p>
                <pre>{prettyJson(workspace)}</pre>
              </article>
              <article className="panel">
                <p className="panel-label">Templates</p>
                <pre>{prettyJson(templates)}</pre>
              </article>
            </div>

            <article className="panel">
              <p className="panel-label">Post template builder</p>
              <div className="form-grid">
                <input
                  value={templateDraft.name}
                  onChange={(event) =>
                    setTemplateDraft((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Template name"
                  className="input-shell"
                />
                <textarea
                  value={templateDraft.post_text}
                  onChange={(event) =>
                    setTemplateDraft((current) => ({ ...current, post_text: event.target.value }))
                  }
                  placeholder="Post text"
                  rows={5}
                  className="textarea-shell"
                />
                <input
                  value={templateDraft.metadata_json.event}
                  onChange={(event) =>
                    setTemplateDraft((current) => ({
                      ...current,
                      metadata_json: { ...current.metadata_json, event: event.target.value },
                    }))
                  }
                  placeholder="Event or series name"
                  className="input-shell"
                />
                <div className="grid compact-grid">
                  {["track", "car", "game", "guests"].map((field) => (
                    <input
                      key={field}
                      value={templateDraft.metadata_json[field] || ""}
                      onChange={(event) =>
                        setTemplateDraft((current) => ({
                          ...current,
                          metadata_json: { ...current.metadata_json, [field]: event.target.value },
                        }))
                      }
                      placeholder={field}
                      className="input-shell"
                    />
                  ))}
                </div>
                <textarea
                  value={(templateDraft.media_urls_json || []).join("\n")}
                  onChange={(event) =>
                    setTemplateDraft((current) => ({
                      ...current,
                      media_urls_json: String(event.target.value || "")
                        .split("\n")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    }))
                  }
                  placeholder="Media URLs (one per line)"
                  rows={3}
                  className="textarea-shell"
                />
                <label className="toggle-row">
                  <input type="checkbox" checked={supportsVideoUpload()} readOnly disabled />
                  <span>Video controls are unavailable in web V2 right now.</span>
                </label>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={Boolean(templateDraft.is_default)}
                    onChange={(event) =>
                      setTemplateDraft((current) => ({
                        ...current,
                        is_default: event.target.checked,
                      }))
                    }
                  />
                  <span>Override Post (set as default template)</span>
                </label>
                <button className="primary-link" onClick={saveTemplate} disabled={busy}>
                  Save template
                </button>
              </div>
            </article>
          </div>
        )}
      </section>
    </main>
  );
}
