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
    type SessionWriter,
} from "../auth.js";

export const authRouter = Router();

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const FONT_MAX_LEN = 80;

function toSessionWriter(writer: {
    id: string;
    slug: string;
    displayName: string;
    cssClass: string;
    handwritingColor: string | null;
    handwritingFont: string | null;
    isAdmin: boolean;
}): SessionWriter {
    return {
        id: writer.id,
        slug: writer.slug,
        displayName: writer.displayName,
        cssClass: writer.cssClass,
        handwritingColor: writer.handwritingColor,
        handwritingFont: writer.handwritingFont,
        isAdmin: writer.isAdmin,
    };
}

function sanitizeFontFamily(raw: unknown): string | null | undefined {
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    if (typeof raw !== "string") return undefined;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.length > FONT_MAX_LEN) return undefined;
    if (/[;{}<>\\]/.test(trimmed)) return undefined;
    return trimmed;
}

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
                handwritingColor: writers.handwritingColor,
                handwritingFont: writers.handwritingFont,
                isAdmin: writers.isAdmin,
            })
            .from(writers)
            .orderBy(writers.displayName);
        res.json({
            writers: rows.map((row) => ({
                ...row,
                handwritingColor: row.handwritingColor ?? null,
                handwritingFont: row.handwritingFont ?? null,
            })),
        });
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
            writer: publicWriter(toSessionWriter(writer)),
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

authRouter.post("/handwriting", requireWriter, async (req: AuthedRequest, res, next) => {
    try {
        const { color, font } = req.body ?? {};
        if (typeof color !== "string" || !HEX_COLOR_RE.test(color)) {
            res.status(400).json({ error: "color must be a hex value like #6a2218" });
            return;
        }
        const handwritingFont = sanitizeFontFamily(font);
        if (handwritingFont === undefined) {
            res.status(400).json({ error: "font must be a Google Fonts family name (or empty for default)" });
            return;
        }

        const [updated] = await db
            .update(writers)
            .set({
                handwritingColor: color,
                handwritingFont,
            })
            .where(eq(writers.id, req.writer!.id))
            .returning({
                id: writers.id,
                slug: writers.slug,
                displayName: writers.displayName,
                cssClass: writers.cssClass,
                handwritingColor: writers.handwritingColor,
                handwritingFont: writers.handwritingFont,
                isAdmin: writers.isAdmin,
            });

        if (!updated) {
            res.status(404).json({ error: "Writer not found" });
            return;
        }

        const session = toSessionWriter(updated);
        req.writer = session;
        res.json({ writer: publicWriter(session) });
    } catch (err) {
        next(err);
    }
});
