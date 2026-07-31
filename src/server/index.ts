import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db/index.js";
import { attachWriter } from "./auth.js";
import { authRouter } from "./routes/auth.js";
import { charactersRouter } from "./routes/characters.js";
import { travelogueRouter } from "./routes/travelogue.js";
import { entriesRouter } from "./routes/entries.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const isProd = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT) || 3000;

async function sendViteHtml(
    vite: ViteDevServer,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
    file: string,
) {
    try {
        const raw = await readFile(resolve(root, "client", file), "utf-8");
        const html = await vite.transformIndexHtml(req.originalUrl, raw);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
    } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
    }
}

async function createApp() {
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use(cookieParser());
    app.use(attachWriter);

    app.get("/api/health", async (_req, res) => {
        try {
            await pool.query("select 1");
            res.json({ ok: true, db: true });
        } catch {
            res.status(503).json({ ok: false, db: false });
        }
    });

    app.use("/api/auth", authRouter);
    app.use("/api/characters", charactersRouter);
    app.use("/api/travelogue", travelogueRouter);
    app.use("/api/entries", entriesRouter);

    function sendProdHtml(res: express.Response, name: string) {
        const prodPath = resolve(root, "dist/client", name);
        const fallback = resolve(root, "client", name);
        res.sendFile(existsSync(prodPath) ? prodPath : fallback);
    }

    if (!isProd) {
        const vite = await createViteServer({
            configFile: resolve(root, "vite.config.ts"),
            server: { middlewareMode: true },
            appType: "custom",
        });
        app.use(vite.middlewares);

        app.get("/", (req, res, next) => sendViteHtml(vite, req, res, next, "index.html"));
        app.get("/travelogue", (req, res, next) =>
            sendViteHtml(vite, req, res, next, "travelogue.html"),
        );
        app.get("/characters", (req, res, next) =>
            sendViteHtml(vite, req, res, next, "characters.html"),
        );
        app.get("/characters/:slug", (req, res, next) =>
            sendViteHtml(vite, req, res, next, "character.html"),
        );
    } else {
        app.use(express.static(resolve(root, "dist/client")));
        app.get("/", (_req, res) => sendProdHtml(res, "index.html"));
        app.get("/travelogue", (_req, res) => sendProdHtml(res, "travelogue.html"));
        app.get("/characters", (_req, res) => sendProdHtml(res, "characters.html"));
        app.get("/characters/:slug", (_req, res) => sendProdHtml(res, "character.html"));
    }

    app.use(
        (
            err: Error,
            _req: express.Request,
            res: express.Response,
            _next: express.NextFunction,
        ) => {
            console.error(err);
            res.status(500).json({ error: "Internal server error" });
        },
    );

    return app;
}

createApp()
    .then((app) => {
        app.listen(port, () => {
            console.log(`Deathless listening on http://localhost:${port}`);
        });
    })
    .catch((err) => {
        console.error("Failed to start server:", err);
        process.exit(1);
    });
