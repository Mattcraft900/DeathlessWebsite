import { Router } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { writers } from "../../db/schema.js";
import {
    clearSessionCookie,
    publicWriter,
    requireWriter,
    setSessionCookie,
    type AuthedRequest,
} from "../auth.js";

export const authRouter = Router();

authRouter.get("/me", (req: AuthedRequest, res) => {
    res.json({ writer: req.writer ? publicWriter(req.writer) : null });
});

authRouter.get("/writers", async (_req, res, next) => {
    try {
        const rows = await db
            .select({
                id: writers.id,
                slug: writers.slug,
                displayName: writers.displayName,
                cssClass: writers.cssClass,
                isAdmin: writers.isAdmin,
            })
            .from(writers)
            .orderBy(writers.displayName);
        res.json({ writers: rows });
    } catch (err) {
        next(err);
    }
});

authRouter.post("/login", async (req, res, next) => {
    try {
        const { slug, pin } = req.body ?? {};
        if (typeof slug !== "string" || typeof pin !== "string") {
            res.status(400).json({ error: "slug and pin are required" });
            return;
        }
        const [writer] = await db.select().from(writers).where(eq(writers.slug, slug)).limit(1);
        if (!writer || !(await bcrypt.compare(pin, writer.pinHash))) {
            res.status(401).json({ error: "Invalid writer or PIN" });
            return;
        }
        setSessionCookie(res, writer.id);
        res.json({
            writer: publicWriter({
                id: writer.id,
                slug: writer.slug,
                displayName: writer.displayName,
                cssClass: writer.cssClass,
                isAdmin: writer.isAdmin,
            }),
        });
    } catch (err) {
        next(err);
    }
});

authRouter.post("/logout", (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
});

authRouter.post("/change-pin", requireWriter, async (req: AuthedRequest, res, next) => {
    try {
        const { currentPin, newPin } = req.body ?? {};
        if (typeof currentPin !== "string" || typeof newPin !== "string" || newPin.length < 4) {
            res.status(400).json({ error: "currentPin and newPin (min 4 chars) are required" });
            return;
        }
        const [writer] = await db.select().from(writers).where(eq(writers.id, req.writer!.id)).limit(1);
        if (!writer || !(await bcrypt.compare(currentPin, writer.pinHash))) {
            res.status(401).json({ error: "Current PIN is incorrect" });
            return;
        }
        const pinHash = await bcrypt.hash(newPin, 10);
        await db.update(writers).set({ pinHash }).where(eq(writers.id, writer.id));
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});
