/**
 * Restore drill: creates a throwaway database, pg_restore from a backup file, sanity-checks, then drops it.
 *
 * Requires: pg_restore on PATH, same major Postgres version as the server that produced the dump (recommended).
 * Requires: DATABASE_URL user can CREATE DATABASE on the server (superuser or CREATEDB role).
 *
 * Usage:
 *   npm run pg:restore-drill -- --backup=.local/backups/pg/watchme-v2-....dump --confirm
 *
 * Options:
 *   --backup=path     (required) .dump file from pg:backup
 *   --confirm         (required) safety gate for production URLs
 *   --keep-db         skip DROP DATABASE (inspect manually, then drop yourself)
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { buildDatabaseUrl, parseDatabaseUrl } = require("./lib/pg-utils");

function runPgRestore(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("pg_restore", args, {
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    child.on("error", (error) => {
      reject(new Error(`pg_restore failed to start: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0 || code === 1) {
        if (code === 1) {
          console.error(
            JSON.stringify({
              at: new Date().toISOString(),
              event: "pg_restore_warnings",
              message:
                "pg_restore exited with code 1 (often warnings). Continuing to verification query.",
            })
          );
        }
        resolve();
      } else {
        reject(new Error(`pg_restore exited with code ${code}`));
      }
    });
  });
}

function parseArgs(argv) {
  const values = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [rawKey, ...rawValue] = arg.slice(2).split("=");
    values[rawKey] = rawValue.length ? rawValue.join("=") : "true";
  }
  return values;
}

function isSafeDrillName(name) {
  return /^watchme_v2_drill_\d+$/.test(name);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const backupPath = path.resolve(
    process.cwd(),
    String(args.backup || "").trim()
  );
  const confirmed = String(args.confirm || "").toLowerCase() === "true";
  const keepDb = String(args.keepDb || "").toLowerCase() === "true";

  if (!backupPath || !fs.existsSync(backupPath)) {
    throw new Error("Missing or invalid --backup=path (.dump file from pg:backup).");
  }
  if (!confirmed) {
    throw new Error(
      "Refusing to run without --confirm (connects to DATABASE_URL and creates a temporary database)."
    );
  }

  const databaseUrl = String(
    args.databaseUrl || process.env.DATABASE_URL || ""
  ).trim();
  const parts = parseDatabaseUrl(databaseUrl);
  const drillName = `watchme_v2_drill_${Date.now()}`;
  if (!isSafeDrillName(drillName)) {
    throw new Error("Internal error: invalid drill database name.");
  }

  const adminUrl = buildDatabaseUrl(parts, "postgres");
  const drillUrl = buildDatabaseUrl(parts, drillName);

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();

  try {
    await admin.query(
      `CREATE DATABASE ${drillName} WITH TEMPLATE template0 ENCODING 'UTF8'`
    );
  } catch (error) {
    await admin.end().catch(() => {});
    throw new Error(
      `CREATE DATABASE failed: ${error.message}. Ensure the role has CREATEDB or use a superuser URL.`
    );
  }
  await admin.end();

  const env = {
    ...process.env,
    PGPASSWORD: parts.password,
  };

  try {
    await runPgRestore(
      [
        "-h",
        parts.host,
        "-p",
        String(parts.port),
        "-U",
        parts.user,
        "-d",
        drillName,
        "--no-owner",
        "--if-exists",
        backupPath,
      ],
      env
    );
  } catch (error) {
    console.error(`pg_restore failed: ${error.message}`);
    await dropDrillDb(adminUrl, drillName);
    process.exit(1);
  }

  const verify = new Client({ connectionString: drillUrl });
  await verify.connect();
  const tables = await verify.query(
    `SELECT COUNT(*)::int AS n
     FROM information_schema.tables
     WHERE table_schema = 'public'`
  );
  const guilds = await verify.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'guilds'
     ) AS ok`
  );
  await verify.end();

  const tableCount = Number(tables.rows[0]?.n || 0);
  const hasGuilds = Boolean(guilds.rows[0]?.ok);
  if (tableCount < 1 || !hasGuilds) {
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        event: "pg_restore_drill_failed_verify",
        tableCount,
        hasGuilds,
      })
    );
    await dropDrillDb(adminUrl, drillName);
    process.exit(1);
  }

  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      event: "pg_restore_drill_ok",
      drillDatabase: drillName,
      publicTables: tableCount,
      hasGuildsTable: hasGuilds,
      keptDatabase: keepDb,
    })
  );

  if (!keepDb) {
    await dropDrillDb(adminUrl, drillName);
  }
}

async function dropDrillDb(adminUrl, drillName) {
  if (!isSafeDrillName(drillName)) {
    return;
  }
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${drillName} WITH (FORCE)`);
  } catch (error) {
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        event: "pg_restore_drill_drop_failed",
        drillDatabase: drillName,
        error: error.message,
        hint: "PostgreSQL 13+ supports DROP ... WITH (FORCE). Drop manually if needed.",
      })
    );
  }
  await admin.end();
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
