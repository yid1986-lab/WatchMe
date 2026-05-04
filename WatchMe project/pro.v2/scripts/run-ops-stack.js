/**
 * Runs API + worker + pager in one terminal for local burn-in and parity with a supervised VPS.
 * Uses the same Node binary as this process; inherits env (DATABASE_URL, INTERNAL_API_TOKEN, etc.).
 *
 * Stop: Ctrl+C or SIGTERM — children receive SIGTERM first.
 */
const { spawn } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");
const node = process.execPath;

const procs = [
  { name: "api", args: [path.join(root, "apps/api/src/index.js")] },
  { name: "worker", args: [path.join(root, "apps/worker/src/index.js")] },
  { name: "pager", args: [path.join(root, "scripts/ops-pager-loop.js")] },
];

const children = [];
let exiting = false;

function prefixLines(name, chunk) {
  String(chunk || "")
    .split("\n")
    .filter((line) => line.length > 0)
    .forEach((line) => console.log(`[stack:${name}] ${line}`));
}

function startChild({ name, args }) {
  const child = spawn(node, args, {
    cwd: root,
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => prefixLines(name, d));
  child.stderr.on("data", (d) => prefixLines(name, d));
  child.on("exit", (code, signal) => {
    if (exiting) {
      return;
    }
    console.error(`[stack] ${name} exited code=${code} signal=${signal || ""}`);
    shutdown(code === 0 ? 0 : 1);
  });
  children.push(child);
}

function shutdown(code = 0) {
  if (exiting) {
    return;
  }
  exiting = true;
  for (const child of children) {
    if (!child.killed && child.exitCode === null) {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(code), 8000).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(JSON.stringify({
  at: new Date().toISOString(),
  event: "ops_stack_start",
  root,
  processes: procs.map((p) => p.name),
}));

for (const spec of procs) {
  startChild(spec);
}
