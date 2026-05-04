const { getLiteConfig } = require("./config");

async function request(path, options = {}) {
  const config = getLiteConfig();
  const method = String(options.method || "GET").toUpperCase();
  const isWriteMethod = !["GET", "HEAD"].includes(method);
  const response = await fetch(`${config.liteApiBaseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(isWriteMethod && config.liteApiWriteToken
        ? { "x-api-token": config.liteApiWriteToken }
        : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const error = new Error(data?.error || data?.message || `Request failed with ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function getLiteCapacity(guildId) {
  return request(`/api/lite/guilds/${encodeURIComponent(guildId)}/capacity`);
}

async function getLiteCreators(guildId) {
  return request(`/api/lite/guilds/${encodeURIComponent(guildId)}/creators`);
}

async function setLiteAlertChannel(guildId, channelId, liveChannelId = channelId) {
  return request(`/api/lite/guilds/${encodeURIComponent(guildId)}/channel`, {
    method: "PUT",
    body: JSON.stringify({
      announce_channel_id: channelId,
      live_channel_id: liveChannelId,
    }),
  });
}

async function addLiteCreator(guildId, payload) {
  return request(`/api/lite/guilds/${encodeURIComponent(guildId)}/creators`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function removeLiteCreator(guildId, liteCreatorId) {
  return request(`/api/lite/guilds/${encodeURIComponent(guildId)}/creators/${encodeURIComponent(liteCreatorId)}`, {
    method: "DELETE",
  });
}

async function getGuildConfig(guildId) {
  return request(`/api/guilds/${encodeURIComponent(guildId)}/config`);
}

module.exports = {
  addLiteCreator,
  getGuildConfig,
  getLiteCapacity,
  getLiteCreators,
  removeLiteCreator,
  setLiteAlertChannel,
};
