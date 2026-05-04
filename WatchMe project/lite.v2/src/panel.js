const { PLAN_LIMITS } = require("./plan-limits");
const { formatPlatformList } = require("./platforms");

function buildLitePanelState({
  guildId,
  alertChannelId = null,
  creators = [],
  upgradeUrl = "https://pro.watchme-bot.com/login",
  backendStatus = null,
}) {
  const limit = PLAN_LIMITS.lite.maxCreatorsPerGuild;
  const isFull = creators.length >= limit;
  const isDegraded = Boolean(backendStatus);
  const statusNotice = backendStatus
    ? {
        title: backendStatus.title || "Lite backend unavailable",
        description:
          backendStatus.description ||
          "Some Lite data could not be loaded. Refresh after the API recovers.",
      }
    : null;
  const canUseActions = !isDegraded;

  return {
    guildId,
    title: "WatchMe Lite Control Panel",
    description: "Manage Twitch and YouTube alerts for this server.",
    alertChannelText: isDegraded ? "`Unavailable right now`" : alertChannelId ? `<#${alertChannelId}>` : "`Not set`",
    creatorsUsedText: isDegraded ? "`Unavailable`" : `${creators.length}/${limit}`,
    supportedPlatformsText: formatPlatformList(PLAN_LIMITS.lite.supportedPlatforms),
    creatorsText: isDegraded
      ? backendStatus?.description || "Lite backend data is unavailable right now. Use Refresh to try again."
      : creators.length > 0
        ? creators.map((creator, index) => `${index + 1}. ${creator.displayName || creator.url}`).join("\n")
        : "No creators saved.",
    actions: [
      { id: "wme:add_channel", label: "Add Channel", style: "primary", disabled: !canUseActions },
      { id: "wme:add_twitch", label: "Add Twitch", style: "success", disabled: !canUseActions || isFull },
      { id: "wme:add_youtube", label: "Add YouTube", style: "success", disabled: !canUseActions || isFull },
      { id: "wme:remove_creator", label: "Remove Creator", style: "danger", disabled: !canUseActions || creators.length === 0 },
      { id: "wme:test_channel", label: "Test Channel", style: "secondary", disabled: !canUseActions },
      { id: "wme:refresh", label: "Refresh", style: "secondary", disabled: false },
    ],
    statusNotice,
    upgradePrompt: isFull
      ? {
          title: "Lite creator limit reached",
          description: `This server has reached ${limit} creators on Lite. Upgrade to Pro to add more creators.`,
          ctaLabel: "Upgrade to Pro",
          upgradeUrl,
        }
      : null,
  };
}

module.exports = {
  buildLitePanelState,
};
