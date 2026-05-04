/**
 * Guilds in Postgres with creator counts (WatchMe V2 data only).
 *
 * - creators_pro: rows in creator_profiles (Pro track, per guild + discord user)
 * - creators_lite: rows in lite_creators (Lite track)
 * - creators_total: sum of both (same guild may rarely have both; still useful as "tracked creators")
 *
 * Usage:
 *   DATABASE_URL=... node scripts/guild-creator-report.js
 *
 * Windows PowerShell (from repo root, after npm install):
 *   .\scripts\run-guild-creator-report.ps1
 */
let Client;
try {
  ({ Client } = require("pg"));
} catch (e) {
  console.error(
    "Could not load the `pg` package. From the watchme-v2 repo root run: npm install"
  );
  console.error(e.message || e);
  process.exit(1);
}

async function main() {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is missing. PowerShell: $env:DATABASE_URL = 'postgres://...'  OR run .\\scripts\\run-guild-creator-report.ps1 from repo root (reads .env)."
    );
  }

  const client = new Client({ connectionString: url });
  try {
    await client.connect();
  } catch (e) {
    throw new Error(
      `Could not connect to Postgres (${e.message || e}). Check DATABASE_URL host, port, password, and that Postgres is running.`
    );
  }
  try {
    const result = await client.query(`
      SELECT
        g.guild_id,
        g.name AS db_name,
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

    const out = {
      at: new Date().toISOString(),
      guildCount: result.rows.length,
      sum_creators_pro: result.rows.reduce((s, r) => s + Number(r.creators_pro || 0), 0),
      sum_creators_lite: result.rows.reduce((s, r) => s + Number(r.creators_lite || 0), 0),
      sum_creators_total: result.rows.reduce((s, r) => s + Number(r.creators_total || 0), 0),
      guilds: result.rows.map((r) => ({
        guild_id: r.guild_id,
        db_name: r.db_name,
        updated_at: r.updated_at,
        creators_pro: Number(r.creators_pro || 0),
        creators_lite: Number(r.creators_lite || 0),
        creators_total: Number(r.creators_total || 0),
      })),
    };

    console.log(JSON.stringify(out, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
