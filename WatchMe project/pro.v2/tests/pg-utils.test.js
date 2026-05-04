const assert = require("node:assert/strict");
const { buildDatabaseUrl, parseDatabaseUrl } = require("../scripts/lib/pg-utils");

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

run("parseDatabaseUrl handles postgres:// with user password host db", () => {
  const p = parseDatabaseUrl("postgres://watchme:secret@127.0.0.1:5432/watchme_v2");
  assert.equal(p.user, "watchme");
  assert.equal(p.password, "secret");
  assert.equal(p.host, "127.0.0.1");
  assert.equal(p.port, "5432");
  assert.equal(p.database, "watchme_v2");
});

run("parseDatabaseUrl decodes URL-encoded credentials", () => {
  const p = parseDatabaseUrl("postgres://user%40x:p%40ss%3Aword@h.example.com:5433/mydb");
  assert.equal(p.user, "user@x");
  assert.equal(p.password, "p@ss:word");
  assert.equal(p.host, "h.example.com");
  assert.equal(p.port, "5433");
  assert.equal(p.database, "mydb");
});

run("buildDatabaseUrl strips unsafe characters from database name", () => {
  const p = parseDatabaseUrl("postgres://u:p@127.0.0.1:5432/original");
  const url = buildDatabaseUrl(p, "watchme_v2_drill_123");
  assert.equal(url.includes("watchme_v2_drill_123"), true);
  assert.equal(url.includes("original"), false);
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
