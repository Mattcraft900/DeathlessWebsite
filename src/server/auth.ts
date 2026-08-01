/**
 * Signed httpOnly cookie session (`deathless_session`).
 * Payload: writerId.expiry.hmac — verified with SESSION_SECRET (timing-safe).
 * `attachWriter` loads the writer onto every request; `requireWriter` / `requireAdmin`
 * gate mutating routes. Client keeps a mirror via `/api/auth/me` + credentials.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { writers, type Writer } from "../db/schema.js";

const COOKIE_NAME = "deathless_session";
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export type SessionWriter = Pick<
    Writer,
    | "id"
    | "slug"
    | "displayName"
    | "cssClass"
    | "handwritingColor"
    | "handwritingFont"
    | "isAdmin"
>;

function secret(): string {
    const value = process.env.SESSION_SECRET;
    if (!value || value === "change-me-to-a-long-random-string") {
        if (process.env.NODE_ENV === "production") {
            throw new Error("SESSION_SECRET must be set in production");
        }
    }
    return value || "dev-only-secret";
}

function sign(payload: string): string {
    return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function setSessionCookie(res: Response, writerId: string): void {
    const exp = Date.now() + MAX_AGE_MS;
    const payload = `${writerId}.${exp}`;
    const token = `${payload}.${sign(payload)}`;
    res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: MAX_AGE_MS,
        path: "/",
    });
}

export function clearSessionCookie(res: Response): void {
    res.clearCookie(COOKIE_NAME, { path: "/" });
}

function parseSession(req: Request): { writerId: string } | null {
    const raw = req.cookies?.[COOKIE_NAME];
    if (!raw || typeof raw !== "string") return null;
    const parts = raw.split(".");
    if (parts.length !== 3) return null;
    const [writerId, expStr, sig] = parts;
    const payload = `${writerId}.${expStr}`;
    const expected = sign(payload);
    try {
        const a = Buffer.from(sig);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    } catch {
        return null;
    }
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || Date.now() > exp) return null;
    return { writerId };
}

export async function loadSessionWriter(req: Request): Promise<SessionWriter | null> {
    const parsed = parseSession(req);
    if (!parsed) return null;
    const [writer] = await db
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
        .where(eq(writers.id, parsed.writerId))
        .limit(1);
    return writer ?? null;
}

export type AuthedRequest = Request & { writer?: SessionWriter | null };

export async function attachWriter(req: AuthedRequest, _res: Response, next: NextFunction) {
    try {
        req.writer = await loadSessionWriter(req);
        next();
    } catch (err) {
        next(err);
    }
}

export function requireWriter(req: AuthedRequest, res: Response, next: NextFunction) {
    if (!req.writer) {
        res.status(401).json({ error: "Login required" });
        return;
    }
    next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
    if (!req.writer) {
        res.status(401).json({ error: "Login required" });
        return;
    }
    if (!req.writer.isAdmin) {
        res.status(403).json({ error: "Admin required" });
        return;
    }
    next();
}

export function publicWriter(writer: SessionWriter) {
    return {
        id: writer.id,
        slug: writer.slug,
        displayName: writer.displayName,
        cssClass: writer.cssClass,
        handwritingColor: writer.handwritingColor ?? null,
        handwritingFont: writer.handwritingFont ?? null,
        isAdmin: writer.isAdmin,
    };
}
