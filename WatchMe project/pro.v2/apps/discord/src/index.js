const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

function loadEnvFile() {
  const envPath = path.resolve(__dirname, "../../../.env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

function getEnv(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

function getConfig() {
  return {
    discordToken: getEnv("DISCORD_BOT_TOKEN", ""),
    databaseUrl: getEnv("DATABASE_URL", "postgres://watchme:watchme@127.0.0.1:5432/watchme_v2"),
    apiBaseUrl: getEnv("PRO_V2_API_BASE_URL", "http://127.0.0.1:3101"),
    publicWriteToken: getEnv("PUBLIC_API_WRITE_TOKEN", ""),
    commandGuildId: getEnv("DISCORD_COMMAND_GUILD_ID", ""),
    dashboardUrl: getEnv("PRO_DASHBOARD_URL", getEnv("PUBLIC_WEB_URL", "https://watchme-bot.com/pro")),
    mobileUrl: getEnv("PRO_ANDROID_URL", "https://watchme-bot.com/pro#android"),
  };
}

function validateConfig(config = getConfig()) {
  const errors = [];
  if (!config.discordToken) {
    errors.push("DISCORD_BOT_TOKEN is required.");
  }
  if (!config.databaseUrl) {
    errors.push("DATABASE_URL is required.");
  }
  return { errors };
}

function getSlashCommands() {
  return [
    new SlashCommandBuilder()
      .setName("watchme")
      .setDescription("Open the WatchMe Pro control tower")
      .toJSON(),
  ];
}

let pool = null;

function getPool(config = getConfig()) {
  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl });
  }
  return pool;
}

function customId(ownerId, kind, action = "") {
  return `watchme-pro-v2:${ownerId}:${kind}:${action}`;
}

function parseCustomId(value) {
  const parts = String(value || "").split(":");
  if (parts.length !== 4 || parts[0] !== "watchme-pro-v2") {
    return null;
  }
  return { ownerId: parts[1], kind: parts[2], action: parts[3] };
}

function truncate(value, max = 1024) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function statusLabel(value) {
  const status = String(value || "pending").trim().toLowerCase();
  if (status === "approved") return "Approved";
  if (status === "disabled") return "Disabled";
  if (status === "incomplete") return "Incomplete";
  return "Pending";
}

function canManageWatchMe(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
  );
}

function normalizeTabForPermissions(tab, interaction) {
  const requested = tab || "admin";
  if ((requested === "admin" || requested === "creators") && !canManageWatchMe(interaction)) {
    return "profile";
  }
  if (!["admin", "creators", "profile"].includes(requested)) {
    return canManageWatchMe(interaction) ? "admin" : "profile";
  }
  return requested;
}

function denyManageReply(interaction) {
  return interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: "Only members with Manage Server can view or change WatchMe Pro admin settings.",
  });
}

function platformSummary(row = {}) {
  const platforms = [];
  if (row.twitch_url) platforms.push("Twitch");
  if (row.youtube_url) platforms.push("YouTube");
  if (row.kick_url) platforms.push("Kick");
  return platforms.join(", ") || "No platforms linked";
}

async function loadDashboardSnapshot(guildId, discordUserId, config) {
  const db = getPool(config);
  const [configResult, creatorsResult, userResult, performanceResult] = await Promise.all([
    db.query("SELECT * FROM guild_config WHERE guild_id = $1", [guildId]),
    db.query(
      `
        SELECT
          cp.discord_user_id,
          cp.display_name,
          cp.twitch_url,
          cp.youtube_url,
          cp.kick_url,
          COALESCE(ca.status, 'pending') AS status
        FROM creator_profiles cp
        LEFT JOIN creator_access ca
          ON ca.guild_id = cp.guild_id
         AND ca.discord_user_id = cp.discord_user_id
        WHERE cp.guild_id = $1
        ORDER BY
          CASE COALESCE(ca.status, 'pending')
            WHEN 'approved' THEN 1
            WHEN 'pending' THEN 2
            WHEN 'incomplete' THEN 3
            WHEN 'disabled' THEN 4
            ELSE 5
          END,
          COALESCE(NULLIF(cp.display_name, ''), cp.discord_user_id)
        LIMIT 12
      `,
      [guildId]
    ),
    db.query(
      `
        SELECT cp.*, COALESCE(ca.status, 'pending') AS access_status
        FROM creator_profiles cp
        LEFT JOIN creator_access ca
          ON ca.guild_id = cp.guild_id
         AND ca.discord_user_id = cp.discord_user_id
        WHERE cp.guild_id = $1
          AND cp.discord_user_id = $2
        LIMIT 1
      `,
      [guildId, discordUserId]
    ),
    db.query(
      `
        SELECT
          COUNT(*)::int AS alert_count,
          COUNT(DISTINCT discord_user_id)::int AS creator_count,
          MAX(posted_at) AS last_live_at
        FROM creator_live_alerts
        WHERE guild_id = $1
          AND posted_at >= NOW() - INTERVAL '7 days'
      `,
      [guildId]
    ).catch(() => ({ rows: [] })),
  ]);

  const creators = creatorsResult.rows || [];
  return {
    config: configResult.rows[0] || null,
    creators,
    userProfile: userResult.rows[0] || null,
    performance: performanceResult.rows[0] || {},
    counts: {
      creators: creators.length,
      approved: creators.filter((row) => row.status === "approved").length,
      pending: creators.filter((row) => row.status === "pending").length,
    },
  };
}

async function apiRequest(config, method, path, body = {}) {
  const url = new URL(path, config.apiBaseUrl.replace(/\/+$/, "") + "/");
  const response = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(config.publicWriteToken ? { "x-api-token": config.publicWriteToken } : {}),
    },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error || data.message || `API ${response.status}`);
  }
  return data;
}

function encodePathPart(value) {
  return encodeURIComponent(String(value || ""));
}

async function saveGuildConfig(interaction, config, patch) {
  return apiRequest(
    config,
    "PUT",
    `/api/guilds/${encodePathPart(interaction.guildId)}/config`,
    patch
  );
}

async function saveCreatorProfile(interaction, config, patch, snapshot = {}) {
  const current = snapshot.userProfile || {};
  return apiRequest(
    config,
    "PUT",
    `/api/guilds/${encodePathPart(interaction.guildId)}/creators/${encodePathPart(interaction.user.id)}/profile`,
    {
      display_name: current.display_name || interaction.user.username,
      twitch_url: current.twitch_url || "",
      youtube_url: current.youtube_url || "",
      kick_url: current.kick_url || "",
      kick_slug: current.kick_slug || "",
      ...patch,
    }
  );
}

async function saveCreatorAccess(interaction, config, discordUserId, status) {
  return apiRequest(
    config,
    "PUT",
    `/api/guilds/${encodePathPart(interaction.guildId)}/creators/${encodePathPart(discordUserId)}/access`,
    {
      status,
      approved_by: interaction.user.id,
    }
  );
}

function buildModal(id, title, fields) {
  const modal = new ModalBuilder().setCustomId(id).setTitle(title);
  for (const field of fields) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(field.id)
          .setLabel(field.label)
          .setStyle(field.style || TextInputStyle.Short)
          .setRequired(Boolean(field.required))
          .setValue(String(field.value || ""))
          .setPlaceholder(field.placeholder || "")
      )
    );
  }
  return modal;
}

function baseEmbed(interaction, title, description, snapshot = {}) {
  const cfg = snapshot.config || {};
  const embed = new EmbedBuilder()
    .setColor(5793266)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp(new Date());

  if (cfg.brand_logo_url) {
    embed.setThumbnail(cfg.brand_logo_url);
  } else if (interaction.guild?.iconURL()) {
    embed.setThumbnail(interaction.guild.iconURL());
  }
  if (cfg.footer_text) {
    embed.setFooter({ text: truncate(cfg.footer_text, 2048) });
  }
  return embed;
}

function buildAdminEmbed(interaction, snapshot) {
  const cfg = snapshot.config || {};
  const perf = snapshot.performance || {};
  return baseEmbed(
    interaction,
    "WatchMe Dashboard - Admin",
    "Server settings and posting controls.",
    snapshot
  ).addFields(
    {
      name: "Alerts",
      value: [
        `Channel: ${cfg.live_channel_id || cfg.announce_channel_id ? `<#${cfg.live_channel_id || cfg.announce_channel_id}>` : "Not set"}`,
        `Cooldown: ${Number(cfg.cooldown_seconds || 0) || 600}s`,
        `Cleanup: ${cfg.auto_cleanup ? "On" : "Off"}`,
        `Embeds: On`,
      ].join("\n"),
      inline: false,
    },
    {
      name: "Branding",
      value: [
        `Title: ${cfg.brand_name || "Not set"}`,
        `Logo: ${cfg.brand_logo_url ? "Set" : "Not set"}`,
        `Footer: ${cfg.footer_text || "Not set"}`,
      ].join("\n"),
      inline: false,
    },
    {
      name: "Stats",
      value: [
        `Creators: ${snapshot.counts.creators}`,
        `Approved: ${snapshot.counts.approved}`,
        `Pending: ${snapshot.counts.pending}`,
        `Alerts posted: ${Number(perf.alert_count || 0)}`,
      ].join("\n"),
      inline: false,
    }
  );
}

function buildCreatorsEmbed(interaction, snapshot) {
  const rows = snapshot.creators || [];
  const list = rows.length
    ? rows.map((row, index) => {
      const name = row.display_name || row.discord_user_id;
      return `**${index + 1}. ${truncate(name, 80)}**\n${statusLabel(row.status)} - ${platformSummary(row)}`;
    }).join("\n\n")
    : "No creators saved in V2 for this server yet.";

  return baseEmbed(
    interaction,
    "WatchMe Dashboard - Creators",
    "Approve and manage creators for this server.",
    snapshot
  ).addFields(
    {
      name: "Summary",
      value: `Approved: ${snapshot.counts.approved}\nPending: ${snapshot.counts.pending}`,
      inline: false,
    },
    {
      name: "Creators",
      value: truncate(list, 4096),
      inline: false,
    }
  );
}

function buildProfileEmbed(interaction, snapshot) {
  const profile = snapshot.userProfile;
  const displayName = profile?.display_name || interaction.user.username;
  return baseEmbed(
    interaction,
    "WatchMe Dashboard - User",
    "Your creator profile for this server.",
    snapshot
  ).addFields(
    {
      name: "Status",
      value: profile ? statusLabel(profile.access_status) : "No profile saved yet",
      inline: false,
    },
    {
      name: displayName,
      value: profile
        ? [
          `Twitch: ${profile.twitch_url || "Not linked"}`,
          `YouTube: ${profile.youtube_url || "Not linked"}`,
          `Kick: ${profile.kick_url || "Not linked"}`,
        ].join("\n")
        : "Open the Pro dashboard or mobile app to create your profile.",
      inline: false,
    }
  );
}

function buildRows(ownerId, config, activeTab = "admin", snapshot = {}, canManage = true) {
  const tabButtons = [];
  if (canManage) {
    tabButtons.push(
      new ButtonBuilder()
        .setCustomId(customId(ownerId, "tab", "admin"))
        .setLabel("Admin")
        .setStyle(activeTab === "admin" ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(customId(ownerId, "tab", "creators"))
        .setLabel("Creators")
        .setStyle(activeTab === "creators" ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
  }
  tabButtons.push(
    new ButtonBuilder()
      .setCustomId(customId(ownerId, "tab", "profile"))
      .setLabel("User")
      .setStyle(activeTab === "profile" ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );
  const tabRow = new ActionRowBuilder().addComponents(...tabButtons);
  const linkRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Open Pro dashboard")
      .setStyle(ButtonStyle.Link)
      .setURL(config.dashboardUrl),
    new ButtonBuilder()
      .setLabel("Android app")
      .setStyle(ButtonStyle.Link)
      .setURL(config.mobileUrl)
  );

  if (activeTab === "creators") {
    const pending = (snapshot.creators || []).filter((row) => row.status === "pending");
    const approved = (snapshot.creators || []).filter((row) => row.status === "approved");
    return [
      tabRow,
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(customId(ownerId, "creator", "approve"))
          .setPlaceholder(pending.length ? "Approve pending creator" : "No pending creators")
          .setDisabled(!pending.length)
          .addOptions((pending.length ? pending : [{ discord_user_id: "none", display_name: "No pending creators" }]).slice(0, 25).map((row) => ({
            label: truncate(row.display_name || row.discord_user_id, 100),
            value: String(row.discord_user_id),
          })))
      ),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(customId(ownerId, "creator", "disable"))
          .setPlaceholder(approved.length ? "Disable approved creator" : "No approved creators")
          .setDisabled(!approved.length)
          .addOptions((approved.length ? approved : [{ discord_user_id: "none", display_name: "No approved creators" }]).slice(0, 25).map((row) => ({
            label: truncate(row.display_name || row.discord_user_id, 100),
            value: String(row.discord_user_id),
          })))
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(customId(ownerId, "creator", "refresh"))
          .setLabel("Resub")
          .setStyle(ButtonStyle.Secondary)
      ),
      linkRow,
    ];
  }

  if (activeTab === "profile") {
    return [
      tabRow,
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(customId(ownerId, "profile", "twitch"))
          .setLabel("Twitch")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(customId(ownerId, "profile", "youtube"))
          .setLabel("YouTube")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(customId(ownerId, "profile", "kick"))
          .setLabel("Add Kick")
          .setStyle(ButtonStyle.Success)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(customId(ownerId, "profile", "edit"))
          .setLabel("Profile")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(customId(ownerId, "profile", "preview"))
          .setLabel("Preview")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(customId(ownerId, "profile", "approval"))
          .setLabel("Approval")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(customId(ownerId, "profile", "socials"))
          .setLabel("Socials")
          .setStyle(ButtonStyle.Secondary)
      ),
      linkRow,
    ];
  }

  return [
    tabRow,
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(customId(ownerId, "admin", "channel"))
        .setLabel("Channel")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(customId(ownerId, "admin", "cooldown"))
        .setLabel("Cooldown")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(customId(ownerId, "admin", "cleanup"))
        .setLabel("Cleanup")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(customId(ownerId, "admin", "preview"))
        .setLabel("Preview")
        .setStyle(ButtonStyle.Success)
    ),
    linkRow,
  ];
}

function buildEmbedForTab(interaction, snapshot, tab) {
  if (tab === "creators") return buildCreatorsEmbed(interaction, snapshot);
  if (tab === "profile") return buildProfileEmbed(interaction, snapshot);
  return buildAdminEmbed(interaction, snapshot);
}

async function buildWatchMeReply(interaction, config, tab = "admin") {
  const activeTab = normalizeTabForPermissions(tab, interaction);
  const snapshot = await loadDashboardSnapshot(interaction.guildId, interaction.user.id, config);
  return {
    flags: MessageFlags.Ephemeral,
    embeds: [buildEmbedForTab(interaction, snapshot, activeTab)],
    components: buildRows(interaction.user.id, config, activeTab, snapshot, canManageWatchMe(interaction)),
  };
}

async function buildWatchMeUpdate(interaction, config, tab = "admin", notice = "") {
  const activeTab = normalizeTabForPermissions(tab, interaction);
  const snapshot = await loadDashboardSnapshot(interaction.guildId, interaction.user.id, config);
  const embed = buildEmbedForTab(interaction, snapshot, activeTab);
  if (notice) {
    embed.addFields({ name: "Updated", value: truncate(notice, 1024), inline: false });
  }
  return {
    embeds: [embed],
    components: buildRows(interaction.user.id, config, activeTab, snapshot, canManageWatchMe(interaction)),
  };
}

async function showChannelPicker(interaction, config) {
  if (!canManageWatchMe(interaction)) {
    return denyManageReply(interaction);
  }
  const snapshot = await loadDashboardSnapshot(interaction.guildId, interaction.user.id, config);
  const embed = buildAdminEmbed(interaction, snapshot).addFields({
    name: "Choose Channel",
    value: "Pick the Discord channel WatchMe Pro should use for live alerts.",
    inline: false,
  });

  return interaction.update({
    embeds: [embed],
    components: [
      buildRows(interaction.user.id, config, "admin", snapshot, true)[0],
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(customId(interaction.user.id, "admin", "channel_select"))
          .setPlaceholder("Select live alert channel")
          .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      ),
      ...buildRows(interaction.user.id, config, "admin", snapshot, true).slice(1),
    ],
  });
}

function profileModalId(ownerId, action) {
  return customId(ownerId, "modal", `profile_${action}`);
}

function adminModalId(ownerId, action) {
  return customId(ownerId, "modal", `admin_${action}`);
}

async function handleAdminButton(interaction, config, action) {
  if (!canManageWatchMe(interaction)) {
    return denyManageReply(interaction);
  }
  const snapshot = await loadDashboardSnapshot(interaction.guildId, interaction.user.id, config);
  const cfg = snapshot.config || {};

  if (action === "channel") {
    return showChannelPicker(interaction, config);
  }

  if (action === "cooldown") {
    return interaction.showModal(buildModal(adminModalId(interaction.user.id, "cooldown"), "Live Alert Cooldown", [
      {
        id: "cooldown_seconds",
        label: "Cooldown seconds",
        value: String(Number(cfg.cooldown_seconds || 0) || 600),
        placeholder: "600",
        required: true,
      },
    ]));
  }

  if (action === "cleanup") {
    await saveGuildConfig(interaction, config, { auto_cleanup: !Boolean(cfg.auto_cleanup) });
    return interaction.update(await buildWatchMeUpdate(
      interaction,
      config,
      "admin",
      `Auto cleanup is now ${cfg.auto_cleanup ? "off" : "on"}.`
    ));
  }

  if (action === "facebook") {
    await saveGuildConfig(interaction, config, {
      socials_feed_channel_id: cfg.socials_feed_channel_id || cfg.live_channel_id || cfg.announce_channel_id || "",
    });
    return interaction.update(await buildWatchMeUpdate(
      interaction,
      config,
      "admin",
      "Social grab channel checked. Connect Facebook from the Socials screen in web/mobile."
    ));
  }

  if (action === "embeds" || action === "crosspost") {
    return interaction.update(await buildWatchMeUpdate(
      interaction,
      config,
      "admin",
      action === "embeds"
        ? "V2 live alerts use embeds by default."
        : "Cross-posting is controlled by connected socials and the social grab channel."
    ));
  }

  if (action === "preview") {
    return interaction.update(await buildWatchMeUpdate(
      interaction,
      config,
      "admin",
      `Preview ready. Live alerts will post to ${cfg.live_channel_id || cfg.announce_channel_id ? `<#${cfg.live_channel_id || cfg.announce_channel_id}>` : "the selected channel once saved"}.`
    ));
  }

  return interaction.update(await buildWatchMeUpdate(interaction, config, "admin"));
}

async function handleProfileButton(interaction, config, action) {
  const snapshot = await loadDashboardSnapshot(interaction.guildId, interaction.user.id, config);
  const profile = snapshot.userProfile || {};

  if (["twitch", "youtube", "kick"].includes(action)) {
    const labels = { twitch: "Twitch URL", youtube: "YouTube URL", kick: "Kick URL" };
    return interaction.showModal(buildModal(profileModalId(interaction.user.id, action), labels[action], [
      {
        id: `${action}_url`,
        label: labels[action],
        value: profile[`${action}_url`] || "",
        placeholder: action === "youtube" ? "https://www.youtube.com/@channel" : `https://${action}.tv/name`,
        required: false,
      },
    ]));
  }

  if (action === "edit") {
    return interaction.showModal(buildModal(profileModalId(interaction.user.id, "edit"), "Creator Profile", [
      {
        id: "display_name",
        label: "Display name",
        value: profile.display_name || interaction.user.username,
        placeholder: interaction.user.username,
        required: true,
      },
    ]));
  }

  if (action === "approval") {
    await saveCreatorAccess(interaction, config, interaction.user.id, "pending");
    return interaction.update(await buildWatchMeUpdate(interaction, config, "profile", "Approval requested."));
  }

  if (action === "preview") {
    return interaction.update(await buildWatchMeUpdate(
      interaction,
      config,
      "profile",
      `${profile.display_name || interaction.user.username}: ${platformSummary(profile)}`
    ));
  }

  if (action === "socials") {
    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `Open socials here: ${config.dashboardUrl}`,
    });
  }

  return interaction.update(await buildWatchMeUpdate(interaction, config, "profile"));
}

async function handleCreatorSelect(interaction, config, action) {
  if (!canManageWatchMe(interaction)) {
    return denyManageReply(interaction);
  }
  const discordUserId = interaction.values?.[0];
  if (!discordUserId || discordUserId === "none") {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: "No creator selected." });
  }

  const status = action === "approve" ? "approved" : "disabled";
  await saveCreatorAccess(interaction, config, discordUserId, status);
  return interaction.update(await buildWatchMeUpdate(
    interaction,
    config,
    "creators",
    `Creator ${discordUserId} set to ${status}.`
  ));
}

async function handleAdminSelect(interaction, config, action) {
  if (!canManageWatchMe(interaction)) {
    return denyManageReply(interaction);
  }
  if (action !== "channel_select") return null;
  const channelId = interaction.values?.[0];
  if (!channelId) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: "No channel selected." });
  }
  await saveGuildConfig(interaction, config, {
    announce_channel_id: channelId,
    live_channel_id: channelId,
  });
  return interaction.update(await buildWatchMeUpdate(
    interaction,
    config,
    "admin",
    `Live alert channel saved as <#${channelId}>.`
  ));
}

async function handleModal(interaction, config, parsed) {
  if (parsed.kind !== "modal") return null;

  if (parsed.action === "admin_cooldown") {
    if (!canManageWatchMe(interaction)) {
      return denyManageReply(interaction);
    }
    const value = Number(interaction.fields.getTextInputValue("cooldown_seconds"));
    if (!Number.isFinite(value) || value < 0) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: "Cooldown must be a valid number." });
    }
    await saveGuildConfig(interaction, config, { cooldown_seconds: Math.round(value) });
    return interaction.update(await buildWatchMeUpdate(interaction, config, "admin", `Cooldown saved as ${Math.round(value)}s.`));
  }

  const snapshot = await loadDashboardSnapshot(interaction.guildId, interaction.user.id, config);

  if (parsed.action === "profile_edit") {
    const displayName = interaction.fields.getTextInputValue("display_name");
    await saveCreatorProfile(interaction, config, { display_name: displayName }, snapshot);
    return interaction.update(await buildWatchMeUpdate(interaction, config, "profile", "Creator profile saved."));
  }

  for (const platform of ["twitch", "youtube", "kick"]) {
    if (parsed.action === `profile_${platform}`) {
      const url = interaction.fields.getTextInputValue(`${platform}_url`);
      await saveCreatorProfile(interaction, config, { [`${platform}_url`]: url }, snapshot);
      return interaction.update(await buildWatchMeUpdate(interaction, config, "profile", `${platformSummary({ ...snapshot.userProfile, [`${platform}_url`]: url })} saved.`));
    }
  }

  return null;
}

async function registerCommands(client, config) {
  if (config.commandGuildId) {
    const guild = await client.guilds.fetch(config.commandGuildId);
    await guild.commands.set(getSlashCommands());
    return `guild ${config.commandGuildId}`;
  }

  await client.application.commands.set(getSlashCommands());
  return "global";
}

async function start() {
  const config = getConfig();
  const validation = validateConfig(config);
  if (process.argv.includes("--check")) {
    if (validation.errors.length) {
      console.error(`[watchme-v2/discord][check] ${validation.errors.join(" ")}`);
      process.exit(1);
    }
    console.log("[watchme-v2/discord][check] config OK");
    return;
  }

  if (validation.errors.length) {
    throw new Error(validation.errors.join(" "));
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once("clientReady", async () => {
    console.log(`[watchme-v2/discord] logged in as ${client.user.tag}`);
    const scope = await registerCommands(client, config);
    console.log(`[watchme-v2/discord] slash commands registered for ${scope}`);
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === "watchme") {
        if (!interaction.guildId) {
          return interaction.reply({
            flags: MessageFlags.Ephemeral,
            content: "WatchMe Pro setup is managed inside a Discord server.",
          });
        }

        return interaction.reply(await buildWatchMeReply(interaction, config));
      }

      if (interaction.isButton()) {
        const parsed = parseCustomId(interaction.customId);
        if (!parsed) return;
        if (parsed.ownerId !== interaction.user.id) {
          return interaction.reply({
            flags: MessageFlags.Ephemeral,
            content: "This WatchMe panel belongs to someone else. Run /watchme to open your own.",
          });
        }

        if (parsed.kind === "tab") {
          if ((parsed.action === "admin" || parsed.action === "creators") && !canManageWatchMe(interaction)) {
            return denyManageReply(interaction);
          }
          return interaction.update(await buildWatchMeUpdate(interaction, config, parsed.action || "admin"));
        }

        if (parsed.kind === "admin") {
          return handleAdminButton(interaction, config, parsed.action);
        }

        if (parsed.kind === "profile") {
          return handleProfileButton(interaction, config, parsed.action);
        }

        if (parsed.kind === "creator" && parsed.action === "refresh") {
          if (!canManageWatchMe(interaction)) {
            return denyManageReply(interaction);
          }
          return interaction.update(await buildWatchMeUpdate(
            interaction,
            config,
            "creators",
            "Creator list refreshed from V2."
          ));
        }
      }

      if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu()) {
        const parsed = parseCustomId(interaction.customId);
        if (!parsed) return;
        if (parsed.ownerId !== interaction.user.id) {
          return interaction.reply({
            flags: MessageFlags.Ephemeral,
            content: "This WatchMe panel belongs to someone else. Run /watchme to open your own.",
          });
        }

        if (parsed.kind === "creator") {
          return handleCreatorSelect(interaction, config, parsed.action);
        }

        if (parsed.kind === "admin") {
          return handleAdminSelect(interaction, config, parsed.action);
        }
      }

      if (interaction.isModalSubmit()) {
        const parsed = parseCustomId(interaction.customId);
        if (!parsed) return;
        if (parsed.ownerId !== interaction.user.id) {
          return interaction.reply({
            flags: MessageFlags.Ephemeral,
            content: "This WatchMe panel belongs to someone else. Run /watchme to open your own.",
          });
        }
        return handleModal(interaction, config, parsed);
      }
    } catch (error) {
      console.error("[watchme-v2/discord] interaction failed", error?.message || error);
      const payload = {
        flags: MessageFlags.Ephemeral,
        content: "WatchMe Pro could not open the control tower just now. Try again in a moment.",
      };
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply(payload).catch(() => null);
      }
      return interaction.reply(payload).catch(() => null);
    }
  });

  await client.login(config.discordToken);
}

if (require.main === module) {
  start().catch((error) => {
    console.error("[watchme-v2/discord] fatal", error?.message || error);
    process.exit(1);
  });
}

module.exports = {
  buildWatchMeReply,
  getSlashCommands,
  validateConfig,
};
