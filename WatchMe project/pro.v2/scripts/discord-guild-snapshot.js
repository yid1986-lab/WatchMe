/**
 * Print guild info (and optionally member sample) from Discord REST for your bot.
 * When DATABASE_URL is set, each guild includes **creator counts** from Postgres
 * (Pro: creator_profiles, Lite: lite_creators).
 *
 * Requires DISCORD_BOT_TOKEN. Guild IDs come from either:
 *   --from-db     (needs DATABASE_URL; uses watchme_v2 `guilds` table + creator counts)
 *   --guild=ID    (repeat for each guild; counts loaded from DB if DATABASE_URL set)
 *
 * Members: add --members (uses GET /guilds/{id}/members). Requires the bot to have
 * the **Server Members Intent** enabled in the Discord Developer Portal, or you get 403.
 *
 * Usage:
 *   DISCORD_BOT_TOKEN=... DATABASE_URL=... node scripts/discord-guild-snapshot.js --from-db
 *   DISCORD_BOT_TOKEN=... node scripts/discord-guild-snapshot.js --guild=123 --guild=456 --members
 */
const { Client } = require("pg");

function parseArgs(argv) {
  const values = { guild: [] };
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [rawKey, ...rawValue] = arg.slice(2).split("=");
    const key = rawKey;
    const val = rawValue.length ? rawValue.join("=") : "true";
    if (key === "guild") {
      values.guild.push(val);
    } else {
      values[key] = val;
    }
  }
  return values;
}

async function discordGet(path, token, baseUrl) {
  const base = String(baseUrl || "https://discord.com/api/v10").replace(/\/+$/, "");
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bot ${token}`,
    },
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const msg = data?.message || text || res.statusText;
    const err = new Error(`Discord HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

async function fetchGuildRowsFromDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required for --from-db");
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT
        g.guild_id,
        g.name,
        g.updated_at,
        (SELECT COUNT(*)::int FROM creator_profiles cp WHERE cp.guild_id = g.guild_id) AS creators_pro,
        (SELECT COUNT(*)::int FROM lite_creators lc WHERE lc.guild_id = g.guild_id) AS creators_lite,
        (
          (SELECT COUNT(*)::int FROM creator_profiles cp WHERE cp.guild_id = g.guild_id)
          + (SELECT COUNT(*)::int FROM lite_creators lc WHERE lc.guild_id = g.guild_id)
        ) AS creators_total
      FROM guilds g
      ORDER BY g.guild_id
    `);
    return result.rows;
  } finally {
    await client.end();
  }
}

async function fetchCreatorCountsForGuildIds(guildIds) {
  const url = process.env.DATABASE_URL;
  if (!url || !guildIds.length) {
    return new Map();
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query(
      `
        SELECT
          x.guild_id::text AS guild_id,
          (SELECT COUNT(*)::int FROM creator_profiles cp WHERE cp.guild_id = x.guild_id) AS creators_pro,
          (SELECT COUNT(*)::int FROM lite_creators lc WHERE lc.guild_id = x.guild_id) AS creators_lite
        FROM unnest($1::text[]) AS x(guild_id)
      `,
      [guildIds]
    );
    const map = new Map();
    for (const row of result.rows) {
      const pro = Number(row.creators_pro || 0);
      const lite = Number(row.creators_lite || 0);
      map.set(String(row.guild_id), {
        creators_pro: pro,
        creators_lite: lite,
        creators_total: pro + lite,
      });
    }
    return map;
  } finally {
    await client.end();
  }
}

function attachCreatorCounts(entry, rowOrMap) {
  if (rowOrMap && ("creators_pro" in rowOrMap || "creators_total" in rowOrMap)) {
    const pro = Number(rowOrMap.creators_pro ?? 0);
    const lite = Number(rowOrMap.creators_lite ?? 0);
    entry.creators_pro = pro;
    entry.creators_lite = lite;
    entry.creators_total = Number(rowOrMap.creators_total ?? pro + lite);
    return;
  }
  if (rowOrMap && rowOrMap.get) {
    const c = rowOrMap.get(entry.guild_id) || {
      creators_pro: 0,
      creators_lite: 0,
      creators_total: 0,
    };
    entry.creators_pro = c.creators_pro;
    entry.creators_lite = c.creators_lite;
    entry.creators_total = c.creators_total;
    return;
  }
  entry.creators_pro = 0;
  entry.creators_lite = 0;
  entry.creators_total = 0;
}

/**
 * Paginate GET /guilds/{id}/members (max 1000 per request).
 */
async function fetchMembers(guildId, token, baseUrl, maxTotal = 5000) {
  const all = [];
  let after = null;
  while (all.length < maxTotal) {
    const qs = new URLSearchParams({ limit: "1000" });
    if (after) {
      qs.set("after", after);
    }
    const batch = await discordGet(
      `/guilds/${guildId}/members?${qs.toString()}`,
      token,
      baseUrl
    );
    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }
    all.push(...batch);
    if (batch.length < 1000) {
      break;
    }
    after = batch[batch.length - 1].user?.id;
    if (!after) {
      break;
    }
  }
  return all;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = String(process.env.DISCORD_BOT_TOKEN || "").trim();
  if (!token) {
    throw new Error("Set DISCORD_BOT_TOKEN in the environment.");
  }
  const baseUrl = process.env.DISCORD_API_BASE_URL || "https://discord.com/api/v10";
  const wantMembers = String(args.members || "").toLowerCase() === "true";
  const fromDb = String(args.fromDb || "").toLowerCase() === "true";
  const maxMembers = Math.min(
    50_000,
    Math.max(100, Number(args.memberMax || 5000) || 5000)
  );

  let rows = [];
  if (fromDb) {
    rows = await fetchGuildRowsFromDb();
  } else if (args.guild.length > 0) {
    rows = args.guild.map((guild_id) => ({ guild_id, name: null }));
  } else {
    throw new Error(
      "Pass --from-db (with DATABASE_URL) or one or more --guild=SNOWFLAKE_ID"
    );
  }

  let countMap = null;
  if (!fromDb && process.env.DATABASE_URL) {
    const ids = rows.map((r) => String(r.guild_id || "").trim()).filter(Boolean);
    countMap = await fetchCreatorCountsForGuildIds(ids);
  }

  const out = {
    at: new Date().toISOString(),
    guildCount: rows.length,
    guilds: [],
  };

  for (const row of rows) {
    const id = String(row.guild_id || "").trim();
    if (!id) continue;

    const entry = {
      guild_id: id,
      db_name: row.name || null,
      db_updated_at: row.updated_at || null,
      discord: null,
      members_error: null,
      member_sample: null,
    };

    if (fromDb) {
      attachCreatorCounts(entry, row);
    } else {
      attachCreatorCounts(entry, countMap);
    }

    try {
      const g = await discordGet(`/guilds/${id}?with_counts=true`, token, baseUrl);
      entry.discord = {
        id: g.id,
        name: g.name,
        approximate_member_count: g.approximate_member_count ?? null,
        approximate_presence_count: g.approximate_presence_count ?? null,
      };
    } catch (e) {
      entry.discord = { error: e.message, status: e.status };
    }

    if (wantMembers && entry.discord && !entry.discord.error) {
      try {
        const members = await fetchMembers(id, token, baseUrl, maxMembers);
        entry.member_sample = members.map((m) => ({
          user_id: m.user?.id,
          username: m.user?.username,
          global_name: m.user?.global_name ?? null,
          bot: Boolean(m.user?.bot),
        }));
        entry.member_count_fetched = members.length;
      } catch (e) {
        entry.members_error = e.message;
        if (e.status === 403) {
          entry.members_hint =
            "Enable Server Members Intent for the bot in the Discord Developer Portal (Privileged Gateway Intents).";
        }
      }
    }

    out.guilds.push(entry);
  }

  out.sum_creators_pro = out.guilds.reduce((s, g) => s + (g.creators_pro || 0), 0);
  out.sum_creators_lite = out.guilds.reduce((s, g) => s + (g.creators_lite || 0), 0);
  out.sum_creators_total = out.guilds.reduce((s, g) => s + (g.creators_total || 0), 0);

  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
