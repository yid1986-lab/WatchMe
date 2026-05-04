const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const {
  addLiteCreator,
  getGuildConfig,
  getLiteCreators,
  removeLiteCreator,
  setLiteAlertChannel,
} = require("./api-client");
const { buildLitePanelState } = require("./panel");
const {
  buildLiteInvalidSubmissionPrompt,
  buildLiteLimitPrompt,
  buildLitePendingPrompt,
  buildLiteSubmissionFailurePrompt,
  formatPromptContent,
} = require("./prompts");
const { formatPlatformName } = require("./platforms");
const { getLiteConfig } = require("./config");

function isManager(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

function getSlashCommands() {
  return [
    new SlashCommandBuilder()
      .setName("wme")
      .setDescription("Open the WatchMe Lite control panel")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON(),
  ];
}

async function safeReply(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload).catch(() => null);
  }
  return interaction.reply(payload).catch(() => null);
}

function formatPermissionList(items) {
  if (items.length <= 1) {
    return items[0] || "";
  }

  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

async function getBotMember(interaction) {
  const guild = interaction.guild;
  if (!guild?.members) {
    return null;
  }

  if (guild.members.me) {
    return guild.members.me;
  }

  if (typeof guild.members.fetchMe === "function") {
    return guild.members.fetchMe().catch(() => null);
  }

  return null;
}

async function checkAlertChannelUsability(interaction, channelId) {
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);

  if (!channel) {
    return {
      status: "blocked",
      message: "I could not load that channel. Please choose a server text channel that WatchMe can access.",
    };
  }

  if (typeof channel.isTextBased !== "function" || !channel.isTextBased() || channel.isDMBased?.()) {
    return {
      status: "blocked",
      message: "Choose a server text channel for alerts. WatchMe Lite cannot save DMs or voice channels.",
    };
  }

  const botMember = await getBotMember(interaction);
  const permissions = botMember ? channel.permissionsFor?.(botMember) : null;

  if (!permissions) {
    return {
      status: "warning",
      message:
        "I saved that channel, but I could not verify the bot's permissions yet. Please run Test Channel after the panel refreshes.",
    };
  }

  const missingPermissions = [];
  if (!permissions.has(PermissionFlagsBits.ViewChannel)) missingPermissions.push("View Channel");
  if (!permissions.has(PermissionFlagsBits.SendMessages)) missingPermissions.push("Send Messages");
  if (!permissions.has(PermissionFlagsBits.EmbedLinks)) missingPermissions.push("Embed Links");

  if (missingPermissions.length) {
    return {
      status: "blocked",
      message: `WatchMe can see <#${channel.id}>, but it needs ${formatPermissionList(
        missingPermissions
      )} to post alerts there.`,
    };
  }

  return {
    status: "ready",
    channel,
  };
}

function describePanelFetchFailure(reason, label) {
  if (reason?.status) {
    return `${label} (HTTP ${reason.status}).`;
  }

  if (reason?.message) {
    return `${label} (${reason.message}).`;
  }

  return `${label}.`;
}

function isBackendFailure(error) {
  if (!error) {
    return false;
  }

  if (Number.isInteger(error.status)) {
    return true;
  }

  const message = String(error.message || "").toLowerCase();
  const causeCode = String(error.cause?.code || "").toLowerCase();
  const backendSignals = [
    "fetch failed",
    "failed to fetch",
    "timeout",
    "timed out",
    "network",
    "socket",
    "connect",
    "econn",
    "enotfound",
    "eai_",
  ];

  return backendSignals.some((signal) => message.includes(signal) || causeCode.includes(signal));
}

function buildInteractionFailureMessage(error) {
  if (isBackendFailure(error)) {
    return "WatchMe Lite could not reach the backend right now, so nothing was changed. Refresh the panel in a moment and try again.";
  }

  return "Something went wrong while handling that action. Refresh the panel and try again.";
}

async function getPanelContext(guildId) {
  const [configResult, creatorsResult] = await Promise.allSettled([
    getGuildConfig(guildId),
    getLiteCreators(guildId),
  ]);

  const cfg = configResult.status === "fulfilled" ? configResult.value?.config || null : null;
  const creators = creatorsResult.status === "fulfilled" ? creatorsResult.value?.creators || [] : [];
  const backendIssues = [];

  if (configResult.status === "rejected") {
    backendIssues.push(describePanelFetchFailure(configResult.reason, "Alert channel data could not be loaded"));
  }

  if (creatorsResult.status === "rejected") {
    backendIssues.push(describePanelFetchFailure(creatorsResult.reason, "Creator data could not be loaded"));
  }

  return buildLitePanelState({
    guildId,
    alertChannelId: cfg?.announce_channel_id || cfg?.live_channel_id || null,
    creators: creators.map((row) => ({
      id: row.lite_creator_id,
      platform: row.platform,
      displayName: row.display_name,
      url: row.url,
    })),
    upgradeUrl: getLiteConfig().upgradeUrl,
    backendStatus: backendIssues.length
      ? {
          title: "Lite backend unavailable",
          description: `${backendIssues.join(" ")} Refresh to try again.`,
        }
      : null,
  });
}

function buildPanelEmbed(panel) {
  const embed = new EmbedBuilder()
    .setColor(panel.statusNotice ? 15548997 : 5793266)
    .setTitle(panel.title)
    .setDescription(panel.description)
    .setTimestamp(new Date());

  const fields = [];

  if (panel.statusNotice) {
    fields.push({
      name: panel.statusNotice.title,
      value: panel.statusNotice.description.slice(0, 1024),
      inline: false,
    });
  }

  fields.push(
    { name: "Alert Channel", value: panel.alertChannelText, inline: false },
    { name: "Creators", value: panel.creatorsUsedText, inline: true },
    { name: "Platforms", value: panel.supportedPlatformsText, inline: true },
    { name: "Saved Creators", value: panel.creatorsText.slice(0, 1024), inline: false }
  );

  embed.addFields(fields);

  if (panel.upgradePrompt) {
    embed.addFields({
      name: panel.upgradePrompt.title,
      value: `${panel.upgradePrompt.description}\n[${panel.upgradePrompt.ctaLabel}](${panel.upgradePrompt.upgradeUrl})`,
      inline: false,
    });
  }

  return embed;
}

function mapButtonStyle(style) {
  if (style === "primary") return ButtonStyle.Primary;
  if (style === "success") return ButtonStyle.Success;
  if (style === "danger") return ButtonStyle.Danger;
  return ButtonStyle.Secondary;
}

function buildPanelComponents(panel) {
  const refreshAction = panel.actions.find((action) => action.id === "wme:refresh");
  const primaryActions = panel.actions.filter((action) => action.id !== "wme:refresh").slice(0, 5);

  return [
    new ActionRowBuilder().addComponents(
      ...primaryActions.map((action) =>
        new ButtonBuilder()
          .setCustomId(action.id)
          .setLabel(action.label)
          .setStyle(mapButtonStyle(action.style))
          .setDisabled(Boolean(action.disabled))
      )
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(refreshAction?.id || "wme:refresh")
        .setLabel(refreshAction?.label || "Refresh")
        .setStyle(mapButtonStyle(refreshAction?.style))
        .setDisabled(Boolean(refreshAction?.disabled))
    ),
  ];
}

async function renderPanel(interaction, options = {}) {
  const guildId = interaction.guildId;
  const panel = await getPanelContext(guildId);
  const payload = {
    embeds: [buildPanelEmbed(panel)],
    components: buildPanelComponents(panel),
    flags: MessageFlags.Ephemeral,
  };

  if (options.content) {
    payload.content = options.content;
  }

  return safeReply(interaction, payload);
}

function buildCreatorModal(platform) {
  const label = platform === "youtube" ? "YouTube URL" : "Twitch URL";
  const placeholder =
    platform === "youtube"
      ? "https://youtube.com/@creator"
      : "https://twitch.tv/creator";

  const modal = new ModalBuilder()
    .setCustomId(`wme:add_creator_modal:${platform}`)
    .setTitle(`Add ${platform === "youtube" ? "YouTube" : "Twitch"} Creator`);

  const urlInput = new TextInputBuilder()
    .setCustomId("url")
    .setLabel(label)
    .setPlaceholder(placeholder)
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const nameInput = new TextInputBuilder()
    .setCustomId("display_name")
    .setLabel("Display Name (optional)")
    .setPlaceholder("Creator name")
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(urlInput),
    new ActionRowBuilder().addComponents(nameInput)
  );

  return modal;
}

async function sendTestAlert(interaction) {
  const guildId = interaction.guildId;
  const configResult = await getGuildConfig(guildId);
  const channelId = configResult?.config?.announce_channel_id || configResult?.config?.live_channel_id || null;

  if (!channelId) {
    return safeReply(interaction, {
      content: "Set an alert channel first.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const channelCheck = await checkAlertChannelUsability(interaction, channelId);
  if (channelCheck.status === "blocked") {
    return safeReply(interaction, {
      content: channelCheck.message,
      flags: MessageFlags.Ephemeral,
    });
  }

  const channel = channelCheck.channel || (await interaction.client.channels.fetch(channelId).catch(() => null));
  if (!channel) {
    return safeReply(interaction, {
      content: "I could not re-open the alert channel. Please refresh the panel and try again.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(5793266)
    .setTitle("Test Live Alert")
    .setDescription("This is how a WatchMe Lite live alert will look.")
    .addFields(
      { name: "Platform", value: "Twitch / YouTube", inline: true },
      { name: "Title", value: "Test live title", inline: true }
    )
    .setTimestamp(new Date());

  try {
    await channel.send({ embeds: [embed] });
  } catch (error) {
    return safeReply(interaction, {
      content:
        "I found the channel, but I still could not send the test alert. Check that WatchMe has View Channel, Send Messages, and Embed Links.",
      flags: MessageFlags.Ephemeral,
    });
  }

  return safeReply(interaction, {
    content:
      channelCheck.status === "warning"
        ? `Test alert sent to <#${channelId}>. I could not verify permissions ahead of time, so please keep an eye on the channel.`
        : `Test alert sent to <#${channelId}>`,
    flags: MessageFlags.Ephemeral,
  });
}

function buildRemoveMenu(creators) {
  const options = creators.slice(0, 25).map((row) => ({
    label: `${formatPlatformName(row.platform)} - ${(row.display_name || row.url).slice(0, 80)}`,
    description: row.url.slice(0, 100),
    value: String(row.lite_creator_id),
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("wme:remove_select")
      .setPlaceholder("Choose a creator to remove")
      .addOptions(options)
  );
}

async function handleChatInput(interaction) {
  if (interaction.commandName !== "wme") return;
  if (!isManager(interaction)) {
    return safeReply(interaction, {
      content: "You need Manage Server to use this.",
      flags: MessageFlags.Ephemeral,
    });
  }
  return renderPanel(interaction);
}

async function handleButton(interaction) {
  if (!isManager(interaction)) {
    return safeReply(interaction, {
      content: "You need Manage Server to use this.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const guildId = interaction.guildId;
  if (!guildId) {
    return safeReply(interaction, {
      content: "This can only be used inside a server.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.customId === "wme:add_channel") {
    const row = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("wme:channel_select")
        .setPlaceholder("Select the alert channel")
        .addChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1)
    );

    return safeReply(interaction, {
      content: "Choose the channel for live alerts:",
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.customId === "wme:add_twitch") {
    return interaction.showModal(buildCreatorModal("twitch"));
  }

  if (interaction.customId === "wme:add_youtube") {
    return interaction.showModal(buildCreatorModal("youtube"));
  }

  if (interaction.customId === "wme:remove_creator") {
    const creatorsResult = await getLiteCreators(guildId);
    const creators = creatorsResult?.creators || [];

    if (!creators.length) {
      return safeReply(interaction, {
        content: "There are no saved creators to remove.",
        flags: MessageFlags.Ephemeral,
      });
    }

    return safeReply(interaction, {
      content: "Choose a creator to remove:",
      components: [buildRemoveMenu(creators)],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.customId === "wme:test_channel") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return sendTestAlert(interaction);
  }

  if (interaction.customId === "wme:refresh") {
    return renderPanel(interaction);
  }
}

async function handleSelectMenu(interaction) {
  if (!isManager(interaction)) {
    return safeReply(interaction, {
      content: "You need Manage Server to use this.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const guildId = interaction.guildId;

  if (interaction.customId === "wme:channel_select") {
    const channelId = interaction.values?.[0];
    const channelCheck = await checkAlertChannelUsability(interaction, channelId);

    if (channelCheck.status === "blocked") {
      return safeReply(interaction, {
        content: channelCheck.message,
        flags: MessageFlags.Ephemeral,
      });
    }

    await setLiteAlertChannel(guildId, channelId);
    return renderPanel(interaction, channelCheck.status === "warning" ? { content: channelCheck.message } : {});
  }

  if (interaction.customId === "wme:remove_select") {
    const liteCreatorId = interaction.values?.[0];
    await removeLiteCreator(guildId, liteCreatorId);
    return renderPanel(interaction);
  }
}

async function handleModal(interaction) {
  if (!isManager(interaction)) {
    return safeReply(interaction, {
      content: "You need Manage Server to use this.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!interaction.customId.startsWith("wme:add_creator_modal:")) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const platform = interaction.customId.split(":").pop();
  const url = interaction.fields.getTextInputValue("url");
  const displayName = interaction.fields.getTextInputValue("display_name");

  try {
    await addLiteCreator(interaction.guildId, {
      platform,
      url,
      display_name: displayName,
      added_by_discord_user_id: interaction.user.id,
    });

    return safeReply(interaction, {
      content: formatPromptContent(buildLitePendingPrompt()),
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    if (error?.status === 409 && error?.data?.code === "LITE_CREATOR_LIMIT_REACHED") {
      const prompt = buildLiteLimitPrompt(error.data.capacity);
      return safeReply(interaction, {
        content: formatPromptContent(prompt),
        flags: MessageFlags.Ephemeral,
      });
    }

    const prompt = error?.status === 400 ? buildLiteInvalidSubmissionPrompt() : buildLiteSubmissionFailurePrompt();
    return safeReply(interaction, {
      content: formatPromptContent(prompt),
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function registerLiteInteractions(client, options = {}) {
  const commandGuildId = String(options.commandGuildId || "").trim();
  if (commandGuildId) {
    const guild = await client.guilds.fetch(commandGuildId);
    await guild.commands.set(getSlashCommands());
  } else {
    await client.application.commands.set(getSlashCommands());
  }

  if (client.__watchmeLiteV2HandlerAttached) return;
  client.__watchmeLiteV2HandlerAttached = true;

  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) return await handleChatInput(interaction);
      if (interaction.isButton()) return await handleButton(interaction);
      if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu()) {
        return await handleSelectMenu(interaction);
      }
      if (interaction.isModalSubmit()) return await handleModal(interaction);
    } catch (error) {
      return safeReply(interaction, {
        content: buildInteractionFailureMessage(error),
        flags: MessageFlags.Ephemeral,
      });
    }
  });
}

module.exports = {
  getSlashCommands,
  registerLiteInteractions,
};
