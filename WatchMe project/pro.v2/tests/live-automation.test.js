const assert = require("node:assert/strict");

const {
  buildAutoThreadName,
  buildStreamEndedMessage,
  evaluateLiveFilters,
  resolveLiveRoleRouting,
} = require("../apps/worker/src/live-automation");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

run("evaluateLiveFilters blocks unmatched categories", () => {
  const result = evaluateLiveFilters(
    {
      liveFilterGames: ["EA FC", "iRacing"],
    },
    {
      game_name: "Valorant",
    }
  );

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "category-filter");
});

run("evaluateLiveFilters accepts matching category, language, and viewer window", () => {
  const result = evaluateLiveFilters(
    {
      liveFilterGames: ["EA FC"],
      liveFilterLanguages: ["en"],
      liveFilterMinViewers: 10,
      liveFilterMaxViewers: 100,
    },
    {
      game_name: "EA FC",
      language: "en",
      viewer_count: 42,
    }
  );

  assert.equal(result.allowed, true);
});

run("resolveLiveRoleRouting overrides the default role on category match", () => {
  const result = resolveLiveRoleRouting(
    {
      liveRoleId: "default-role",
      mentionMode: "role",
      categoryRoleRoutes: [
        { category: "EA FC", role_id: "ea-role", mention_mode: "both" },
      ],
    },
    {
      game_name: "EA FC",
    }
  );

  assert.equal(result.liveRoleId, "ea-role");
  assert.equal(result.mentionMode, "both");
});

run("buildAutoThreadName expands placeholders", () => {
  const result = buildAutoThreadName({
    autoStartThreadName: "{creator} | {category}",
    platform: "twitch",
    payload: {
      broadcaster_user_name: "WatchMe",
      game_name: "iRacing",
    },
  });

  assert.equal(result, "WatchMe | iRacing");
});

run("buildStreamEndedMessage expands the follow-up template", () => {
  const result = buildStreamEndedMessage(
    {
      platform: "twitch",
      streamEndMessageEnabled: true,
      streamEndMessageTemplate: "{creator} finished a {category} stream on {platform}.",
    },
    {
      broadcaster_user_name: "WatchMe",
      game_name: "iRacing",
    }
  );

  assert.equal(result.content, "WatchMe finished a iRacing stream on twitch.");
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
