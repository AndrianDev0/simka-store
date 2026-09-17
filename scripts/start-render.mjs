import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { purgeExpiredAnalytics } from "./analytics-retention.mjs";

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
let cleanupRunning = false;

async function runCleanup() {
  if (cleanupRunning) return;
  cleanupRunning = true;
  try {
    const removed = await purgeExpiredAnalytics();
    console.log(`Analytics retention cleanup: ${removed.events} events, ${removed.sessions} sessions, ${removed.visitors} visitors removed`);
  } catch (error) {
    console.error("Analytics retention cleanup failed", error instanceof Error ? error.message : error);
  } finally {
    cleanupRunning = false;
  }
}

await import("./init-postgres.mjs");
await runCleanup();
const cleanupTimer = setInterval(() => { void runCleanup(); }, CLEANUP_INTERVAL_MS);

const cliPath = fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url));
const server = spawn(process.execPath, [cliPath, "start", "--hostname", "0.0.0.0", "--port", process.env.PORT || "3000"], {
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}

server.once("error", (error) => {
  clearInterval(cleanupTimer);
  console.error("Unable to start the web server", error);
  process.exit(1);
});

server.once("exit", (code, signal) => {
  clearInterval(cleanupTimer);
  process.exit(code ?? (signal ? 0 : 1));
});
