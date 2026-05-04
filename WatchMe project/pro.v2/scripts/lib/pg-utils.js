const { spawn } = require("child_process");

/**
 * @param {string} raw
 * @returns {{ user: string, password: string, host: string, port: string, database: string }}
 */
function parseDatabaseUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    throw new Error("DATABASE_URL is empty.");
  }

  let normalized = trimmed;
  if (normalized.startsWith("postgres://")) {
    normalized = `postgresql://${normalized.slice("postgres://".length)}`;
  }

  let url;
  try {
    url = new URL(normalized);
  } catch (error) {
    throw new Error(`Invalid DATABASE_URL: ${error?.message || error}`);
  }

  if (url.protocol !== "postgresql:") {
    throw new Error(`DATABASE_URL must use postgres:// or postgresql:// (got ${url.protocol}).`);
  }

  const database = String(url.pathname || "")
    .replace(/^\//, "")
    .split("/")[0]
    .trim();
  if (!database) {
    throw new Error("DATABASE_URL must include a database name in the path.");
  }

  const user = decodeURIComponent(url.username || "");
  const password = decodeURIComponent(url.password || "");
  const host = url.hostname || "127.0.0.1";
  const port = url.port || "5432";

  return { user, password, host, port, database };
}

/**
 * Connection string for `databaseName` on the same server as `parts`.
 */
function buildDatabaseUrl(parts, databaseName) {
  const safeDb = String(databaseName || "").replace(/[^a-zA-Z0-9_]/g, "");
  if (!safeDb) {
    throw new Error("Invalid database name.");
  }
  const u = encodeURIComponent(parts.user);
  const p = encodeURIComponent(parts.password);
  return `postgresql://${u}:${p}@${parts.host}:${parts.port}/${safeDb}`;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio || "inherit",
      env: { ...process.env, ...options.env },
      cwd: options.cwd,
    });
    child.on("error", (error) => {
      reject(new Error(`${command} failed to start: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

module.exports = {
  buildDatabaseUrl,
  parseDatabaseUrl,
  runCommand,
};
