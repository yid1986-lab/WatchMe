const test = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("node:events");

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  const original = require.cache[resolved];

  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };

  return () => {
    if (original) {
      require.cache[resolved] = original;
    } else {
      delete require.cache[resolved];
    }
  };
}

function loadRuntimeWithMocks({ apiClient, config }) {
  const restoreApiClient = mockModule("../src/api-client", apiClient);
  const restoreConfig = mockModule("../src/config", config);
  const runtimePath = require.resolve("../src/discord-runtime");
  delete require.cache[runtimePath];
  const runtime = require("../src/discord-runtime");

  return {
    runtime,
    restore() {
      delete require.cache[runtimePath];
      restoreConfig();
      restoreApiClient();
    },
  };
}

function makeFakeClient(channelFetch = async () => null) {
  const client = new EventEmitter();
  client.application = {
    commands: {
      setCalls: [],
      async set(commands) {
        this.setCalls.push(commands);
        return commands;
      },
    },
  };
  client.channels = {
    fetch: channelFetch,
  };

  return client;
}

function makeInteraction(overrides = {}) {
  const record = {
    replies: [],
    edits: [],
    modals: [],
    deferred: false,
  };

  const interaction = {
    guildId: "guild-123",
    commandName: "wme",
    customId: "",
    user: { id: "user-123" },
    guild: {
      members: {
        me: { id: "bot-123" },
      },
    },
    memberPermissions: { has: () => true },
    client: makeFakeClient(),
    fields: {
      getTextInputValue() {
        return "";
      },
    },
    values: [],
    deferred: false,
    replied: false,
    reply: async (payload) => {
      record.replies.push(payload);
      interaction.replied = true;
      return payload;
    },
    editReply: async (payload) => {
      record.edits.push(payload);
      interaction.replied = true;
      return payload;
    },
    deferReply: async () => {
      record.deferred = true;
      interaction.deferred = true;
    },
    showModal: async (modal) => {
      record.modals.push(modal);
      return modal;
    },
    isChatInputCommand: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isModalSubmit: () => false,
  };

  return Object.assign(interaction, overrides, { record });
}

function makeSendableChannel(id = "chan-1") {
  return {
    id,
    isTextBased: () => true,
    isDMBased: () => false,
    permissionsFor: () => ({
      has: () => true,
    }),
    async send(payload) {
      this.sent = payload;
      return payload;
    },
  };
}

function makeBlockedChannel(id = "chan-blocked") {
  return {
    id,
    isTextBased: () => true,
    isDMBased: () => false,
    permissionsFor: () => ({
      has: () => false,
    }),
  };
}

test("Lite interaction smoke path renders the panel and replies with safe prompt copy", async () => {
  const apiClient = {
    addLiteCreator: async () => ({}),
    getGuildConfig: async () => ({ config: { announce_channel_id: "chan-1", live_channel_id: "chan-1" } }),
    getLiteCreators: async () => ({
      creators: [{ lite_creator_id: "1", platform: "youtube", display_name: "Creator One", url: "https://youtube.com/@creatorone" }],
    }),
    removeLiteCreator: async () => ({}),
    setLiteAlertChannel: async () => ({}),
  };

  const config = { getLiteConfig: () => ({ upgradeUrl: "https://pro.watchme-bot.com/login" }) };
  const { runtime, restore } = loadRuntimeWithMocks({ apiClient, config });

  try {
    const client = makeFakeClient();
    await runtime.registerLiteInteractions(client);

    assert.equal(client.application.commands.setCalls.length, 1);
    assert.equal(client.application.commands.setCalls[0][0].name, "wme");

    const chatInteraction = makeInteraction({
      client,
      isChatInputCommand: () => true,
    });
    client.emit("interactionCreate", chatInteraction);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(chatInteraction.record.replies.length, 1);
    const panelEmbed = chatInteraction.record.replies[0].embeds[0].toJSON();
    assert.equal(panelEmbed.title, "WatchMe Lite Control Panel");
    assert.equal(panelEmbed.fields[2].value, "Twitch + YouTube");

    const modalInteraction = makeInteraction({
      client,
      isModalSubmit: () => true,
      customId: "wme:add_creator_modal:twitch",
      fields: {
        getTextInputValue(field) {
          if (field === "url") return "https://twitch.tv/example";
          if (field === "display_name") return "Example";
          return "";
        },
      },
    });
    client.emit("interactionCreate", modalInteraction);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(modalInteraction.record.deferred, true);
    assert.equal(modalInteraction.record.edits.length, 1);
    assert.equal(
      modalInteraction.record.edits[0].content,
      "\u2705 Creator links received\nYour creator details were saved and are waiting to be processed. WatchMe will start posting alerts once Lite finishes syncing the creator.\nYou can update your links later if needed."
    );
  } finally {
    restore();
  }
});

test("Lite interaction smoke path blocks unusable alert channels before saving", async () => {
  let saveCalls = 0;
  const apiClient = {
    addLiteCreator: async () => ({}),
    getGuildConfig: async () => ({ config: {} }),
    getLiteCreators: async () => ({ creators: [] }),
    removeLiteCreator: async () => ({}),
    setLiteAlertChannel: async () => {
      saveCalls += 1;
    },
  };

  const config = { getLiteConfig: () => ({ upgradeUrl: "https://pro.watchme-bot.com/login" }) };
  const { runtime, restore } = loadRuntimeWithMocks({ apiClient, config });

  try {
    const client = makeFakeClient(async () => makeBlockedChannel());
    await runtime.registerLiteInteractions(client);

    const selectInteraction = makeInteraction({
      client,
      isChannelSelectMenu: () => true,
      customId: "wme:channel_select",
      values: ["chan-blocked"],
    });
    client.emit("interactionCreate", selectInteraction);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(saveCalls, 0);
    assert.equal(selectInteraction.record.replies.length, 1);
    assert.match(selectInteraction.record.replies[0].content, /needs View Channel, Send Messages and Embed Links/i);
  } finally {
    restore();
  }
});

test("Lite interaction smoke path sends a test alert only to a usable channel", async () => {
  const sentEmbeds = [];
  const apiClient = {
    addLiteCreator: async () => ({}),
    getGuildConfig: async () => ({ config: { announce_channel_id: "chan-safe" } }),
    getLiteCreators: async () => ({ creators: [] }),
    removeLiteCreator: async () => ({}),
    setLiteAlertChannel: async () => ({}),
  };

  const config = { getLiteConfig: () => ({ upgradeUrl: "https://pro.watchme-bot.com/login" }) };
  const { runtime, restore } = loadRuntimeWithMocks({ apiClient, config });

  try {
    const channel = makeSendableChannel("chan-safe");
    channel.send = async (payload) => {
      sentEmbeds.push(payload);
      return payload;
    };

    const client = makeFakeClient(async () => channel);
    await runtime.registerLiteInteractions(client);

    const buttonInteraction = makeInteraction({
      client,
      isButton: () => true,
      customId: "wme:test_channel",
    });
    client.emit("interactionCreate", buttonInteraction);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(buttonInteraction.record.deferred, true);
    assert.equal(buttonInteraction.record.edits.length, 1);
    assert.match(buttonInteraction.record.edits[0].content, /Test alert sent to <#chan-safe>/);
    assert.equal(sentEmbeds.length, 1);
  } finally {
    restore();
  }
});

test("Lite interaction smoke path keeps raw backend errors out of Discord", async () => {
  const apiClient = {
    addLiteCreator: async () => {
      const error = new Error("database exploded");
      error.status = 500;
      throw error;
    },
    getGuildConfig: async () => ({ config: {} }),
    getLiteCreators: async () => ({ creators: [] }),
    removeLiteCreator: async () => ({}),
    setLiteAlertChannel: async () => ({}),
  };

  const config = { getLiteConfig: () => ({ upgradeUrl: "https://pro.watchme-bot.com/login" }) };
  const { runtime, restore } = loadRuntimeWithMocks({ apiClient, config });

  try {
    const client = makeFakeClient();
    await runtime.registerLiteInteractions(client);

    const modalInteraction = makeInteraction({
      client,
      isModalSubmit: () => true,
      customId: "wme:add_creator_modal:twitch",
      fields: {
        getTextInputValue(field) {
          if (field === "url") return "https://twitch.tv/example";
          return "";
        },
      },
    });
    client.emit("interactionCreate", modalInteraction);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(modalInteraction.record.edits.length, 1);
    assert.match(modalInteraction.record.edits[0].content, /Could not save creator link/);
    assert.doesNotMatch(modalInteraction.record.edits[0].content, /database exploded/);
  } finally {
    restore();
  }
});

test("Lite interaction smoke path sanitizes backend failures while loading creator removal options", async () => {
  const apiClient = {
    addLiteCreator: async () => ({}),
    getGuildConfig: async () => ({ config: {} }),
    getLiteCreators: async () => {
      const error = new Error("fetch failed");
      throw error;
    },
    removeLiteCreator: async () => ({}),
    setLiteAlertChannel: async () => ({}),
  };

  const config = { getLiteConfig: () => ({ upgradeUrl: "https://pro.watchme-bot.com/login" }) };
  const { runtime, restore } = loadRuntimeWithMocks({ apiClient, config });

  try {
    const client = makeFakeClient();
    await runtime.registerLiteInteractions(client);

    const buttonInteraction = makeInteraction({
      client,
      isButton: () => true,
      customId: "wme:remove_creator",
    });
    client.emit("interactionCreate", buttonInteraction);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(buttonInteraction.record.replies.length, 1);
    assert.match(buttonInteraction.record.replies[0].content, /could not reach the backend right now/i);
    assert.match(buttonInteraction.record.replies[0].content, /nothing was changed/i);
    assert.doesNotMatch(buttonInteraction.record.replies[0].content, /fetch failed/i);
  } finally {
    restore();
  }
});

test("Lite interaction smoke path sanitizes deferred backend failures during test-channel checks", async () => {
  const apiClient = {
    addLiteCreator: async () => ({}),
    getGuildConfig: async () => {
      const error = new Error("database timeout");
      error.status = 503;
      throw error;
    },
    getLiteCreators: async () => ({ creators: [] }),
    removeLiteCreator: async () => ({}),
    setLiteAlertChannel: async () => ({}),
  };

  const config = { getLiteConfig: () => ({ upgradeUrl: "https://pro.watchme-bot.com/login" }) };
  const { runtime, restore } = loadRuntimeWithMocks({ apiClient, config });

  try {
    const client = makeFakeClient();
    await runtime.registerLiteInteractions(client);

    const buttonInteraction = makeInteraction({
      client,
      isButton: () => true,
      customId: "wme:test_channel",
    });
    client.emit("interactionCreate", buttonInteraction);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(buttonInteraction.record.deferred, true);
    assert.equal(buttonInteraction.record.edits.length, 1);
    assert.match(buttonInteraction.record.edits[0].content, /could not reach the backend right now/i);
    assert.doesNotMatch(buttonInteraction.record.edits[0].content, /database timeout/i);
  } finally {
    restore();
  }
});
