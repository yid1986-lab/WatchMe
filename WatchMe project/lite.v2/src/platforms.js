function formatPlatformName(platform) {
  const normalized = String(platform || "").trim().toLowerCase();

  if (normalized === "youtube") {
    return "YouTube";
  }

  if (normalized === "twitch") {
    return "Twitch";
  }

  if (normalized === "kick") {
    return "Kick";
  }

  if (!normalized) {
    return "";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatPlatformList(platforms) {
  return (platforms || []).map(formatPlatformName).join(" + ");
}

module.exports = {
  formatPlatformList,
  formatPlatformName,
};
