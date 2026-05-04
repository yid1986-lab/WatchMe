function getEnv(name, fallback = "") {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return String(value);
}

function getLiteConfig() {
  return {
    discordToken: getEnv("LITE_DISCORD_TOKEN", ""),
    liteApiBaseUrl: getEnv("LITE_API_BASE_URL", "http://127.0.0.1:3201"),
    liteApiWriteToken: getEnv("LITE_API_WRITE_TOKEN", ""),
    liteDatabaseUrl: getEnv("LITE_DATABASE_URL", ""),
    upgradeUrl: getEnv("LITE_PRO_UPGRADE_URL", "https://pro.watchme-bot.com/login"),
    commandGuildId: getEnv("LITE_COMMAND_GUILD_ID", ""),
  };
}

module.exports = {
  getLiteConfig,
};
