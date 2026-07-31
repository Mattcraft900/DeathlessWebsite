/**
 * Starts an embedded Postgres on port 5433 for local dev without Docker.
 * Writes .env with DATABASE_URL if missing, then keeps the process alive.
 *
 * Usage: npx tsx scripts/local-db.ts
 *
 * Reuses .pgdata if it was already initialized (e.g. after quitting and coming back).
 * If Postgres is already running from a previous session, prints a note and stays attached.
 * To wipe and start fresh: stop this script, delete .pgdata, then run this again + npm run db:setup.
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync, writeFileSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dataDir = resolve(root, ".pgdata");
const port = 5433;
const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
const pidFile = resolve(dataDir, "postmaster.pid");

mkdirSync(dataDir, { recursive: true });

function isPortOpen(host: string, portNum: number): Promise<boolean> {
    return new Promise((resolvePort) => {
        const socket = net.connect({ host, port: portNum }, () => {
            socket.end();
            resolvePort(true);
        });
        socket.on("error", () => resolvePort(false));
    });
}

function pidIsAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function clearStalePidFile(): void {
    if (!existsSync(pidFile)) return;
    const firstLine = readFileSync(pidFile, "utf8").split(/\r?\n/)[0]?.trim();
    const pid = Number(firstLine);
    if (!Number.isFinite(pid) || pidIsAlive(pid)) return;
    unlinkSync(pidFile);
    console.log(`Removed stale postmaster.pid (old PID ${pid} is gone).`);
}

function ensureEnv(): void {
    const envPath = resolve(root, ".env");
    if (!existsSync(envPath)) {
        writeFileSync(
            envPath,
            `DATABASE_URL=${databaseUrl}\nSESSION_SECRET=dev-local-secret-change-me\nPORT=3000\nSEED_DEFAULT_PIN=deathless\n`,
        );
        console.log("Wrote .env");
    } else {
        console.log(
            ".env already exists — ensure DATABASE_URL points at the embedded DB if you use this script.",
        );
    }
}

clearStalePidFile();

if (await isPortOpen("127.0.0.1", port)) {
    console.log(`Postgres is already running on port ${port}.`);
    console.log(`DATABASE_URL=${databaseUrl}`);
    ensureEnv();
    console.log("Leave this terminal open (or just use npm run dev in another). Ctrl+C here is fine either way.");
    await new Promise(() => {});
}

const alreadyInitialized = existsSync(resolve(dataDir, "PG_VERSION"));

const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: true,
});

if (!alreadyInitialized) {
    await pg.initialise();
    console.log("Initialized new Postgres data directory.");
} else {
    console.log("Reusing existing .pgdata cluster.");
}

await pg.start();
console.log(`Embedded Postgres running on port ${port}`);
console.log(`DATABASE_URL=${databaseUrl}`);
ensureEnv();

async function stop() {
    try {
        await pg.stop();
    } catch {
        // ignore stop errors on shutdown
    }
    process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

// Keep alive
await new Promise(() => {});
