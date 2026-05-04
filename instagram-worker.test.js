/**
 * Logical backup of the WatchMe V2 database using pg_dump (custom format).
 *
 * Requires PostgreSQL client tools on PATH: pg_dump
 *
 * Usage:
 *   DATABASE_URL=... node scripts/pg-backup.js
 *   node scripts/pg-backup.js --outDir=.local/backups/pg
 */
const fs = require("fs");
const path = require("path");
const { parseDatabaseUrl, runCommand } = require("./lib/pg-utils");

function parseArgs(argv) {
  const values = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [rawKey, ...rawValue] = arg.slice(2).split("=");
    values[rawKey] = rawValue.length ? rawValue.join("=") : "true";
  }
  return values;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function localTimestamp() {
  const d = new Date();
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = String(
    args.databaseUrl || process.env.DATABASE_URL || ""
  ).trim();
  const parts = parseDatabaseUrl(databaseUrl);

  const outDir = path.resolve(
    process.cwd(),
    String(args.outDir || ".local/backups/pg").trim() || ".local/backups/pg"
  );
  fs.mkdirSync(outDir, { recursive: true });

  const baseName = String(args.fileName || `watchme-v2-${localTimestamp()}.dump`).trim();
  const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const outFile = path.join(outDir, safeName.endsWith(".dump") ? safeName : `${safeName}.dump`);

  const env = {
    ...process.env,
    PGPASSWORD: parts.password,
  };

  await runCommand(
    "pg_dump",
    [
      "-h",
      parts.host,
      "-p",
      String(parts.port),
      "-U",
      parts.user,
      "-Fc",
      "-f",
      outFile,
      parts.database,
    ],
    { env }
  );

  const stat = fs.statSync(outFile);
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      event: "pg_backup_complete",
      file: outFile,
      bytes: stat.size,
      database: parts.database,
    })
  );
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
