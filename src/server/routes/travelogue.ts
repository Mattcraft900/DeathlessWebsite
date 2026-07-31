/**
 * Travelogue sessions API.
 * - GET /toc — flat Jump-to outline (sessions + unique dateKeys; prologue skipped
 *   as a date row — client treats it as session-only).
 * - GET /sessions?limit&after — cursor pagination by session sortRank; each session
 *   includes nested game_date chunks with blocks. `nextCursor` is the last page
 *   session's sortRank (or null).
 * - POST /sessions — admin creates a session (+ optional empty date chunk).
 */
import { Router } from "express";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { db } from "../../db/index.js";
import { blocks, entries, writers } from "../../db/schema.js";
import { requireAdmin, type AuthedRequest } from "../auth.js";

export const travelogueRouter = Router();

travelogueRouter.get("/toc", async (_req, res, next) => {
    try {
        const sessionRows = await db
            .select({
                id: entries.id,
                title: entries.title,
                sortRank: entries.sortRank,
            })
            .from(entries)
            .where(eq(entries.type, "travelogue_session"))
            .orderBy(asc(entries.sortRank));

        const dateChunks = await db
            .select({
                id: entries.id,
                title: entries.title,
                dateKey: entries.dateKey,
                sortRank: entries.sortRank,
                parentId: entries.parentId,
                showHeading: entries.showHeading,
            })
            .from(entries)
            .where(eq(entries.type, "game_date"))
            .orderBy(asc(entries.sortRank));

        const headedByDateKey = new Map<string, (typeof dateChunks)[number]>();
        for (const chunk of dateChunks) {
            if (!chunk.dateKey || !chunk.showHeading) continue;
            if (!headedByDateKey.has(chunk.dateKey)) headedByDateKey.set(chunk.dateKey, chunk);
        }

        const datesByParent = new Map<string, typeof dateChunks>();
        for (const chunk of dateChunks) {
            if (!chunk.parentId) continue;
            const list = datesByParent.get(chunk.parentId) ?? [];
            list.push(chunk);
            datesByParent.set(chunk.parentId, list);
        }

        const seen = new Set<string>();
        const sessions = sessionRows.map((session) => {
            const dates: {
                dateKey: string;
                title: string;
                anchorEntryId: string;
            }[] = [];

            const children = [...(datesByParent.get(session.id) ?? [])];
            children.sort((a, b) =>
                a.sortRank < b.sortRank ? -1 : a.sortRank > b.sortRank ? 1 : 0,
            );

            for (const chunk of children) {
                if (!chunk.dateKey || chunk.dateKey === "prologue" || seen.has(chunk.dateKey)) {
                    continue;
                }
                seen.add(chunk.dateKey);
                const headed = headedByDateKey.get(chunk.dateKey) ?? chunk;
                dates.push({
                    dateKey: chunk.dateKey,
                    title: headed.title || chunk.title || chunk.dateKey,
                    anchorEntryId: headed.id,
                });
            }

            return {
                id: session.id,
                title: session.title,
                sortRank: session.sortRank,
                dates,
            };
        });

        res.json({ sessions });
    } catch (err) {
        next(err);
    }
});

travelogueRouter.get("/sessions", async (req, res, next) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 3, 20);
        // Cursor = sortRank of last session from previous page (exclusive)
        const after = typeof req.query.after === "string" ? req.query.after : null;

        const sessionRows = await db
            .select()
            .from(entries)
            .where(
                after
                    ? and(eq(entries.type, "travelogue_session"), gt(entries.sortRank, after))
                    : eq(entries.type, "travelogue_session"),
            )
            .orderBy(asc(entries.sortRank))
            .limit(limit + 1);

        // Fetch limit+1 to detect hasMore without a separate count query
        const hasMore = sessionRows.length > limit;
        const page = hasMore ? sessionRows.slice(0, limit) : sessionRows;

        const result = [];
        for (const session of page) {
            const dateChunks = await db
                .select()
                .from(entries)
                .where(and(eq(entries.type, "game_date"), eq(entries.parentId, session.id)))
                .orderBy(asc(entries.sortRank));

            const chunks = [];
            for (const chunk of dateChunks) {
                const chunkBlocks = await db
                    .select({
                        id: blocks.id,
                        entryId: blocks.entryId,
                        writerId: blocks.writerId,
                        body: blocks.body,
                        startsParagraph: blocks.startsParagraph,
                        sortRank: blocks.sortRank,
                        writerSlug: writers.slug,
                        writerCssClass: writers.cssClass,
                        writerDisplayName: writers.displayName,
                    })
                    .from(blocks)
                    .innerJoin(writers, eq(blocks.writerId, writers.id))
                    .where(eq(blocks.entryId, chunk.id))
                    .orderBy(asc(blocks.sortRank));

                chunks.push({
                    id: chunk.id,
                    type: chunk.type,
                    title: chunk.title,
                    dateKey: chunk.dateKey,
                    showHeading: chunk.showHeading,
                    version: chunk.version,
                    sortRank: chunk.sortRank,
                    blocks: chunkBlocks,
                });
            }

            result.push({
                id: session.id,
                type: session.type,
                title: session.title,
                sortRank: session.sortRank,
                gameDates: chunks,
            });
        }

        res.json({
            sessions: result,
            nextCursor: hasMore ? page[page.length - 1]?.sortRank ?? null : null,
        });
    } catch (err) {
        next(err);
    }
});

travelogueRouter.post("/sessions", requireAdmin, async (req: AuthedRequest, res, next) => {
    try {
        const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
        if (!title) {
            res.status(400).json({ error: "title is required" });
            return;
        }

        const [last] = await db
            .select({ sortRank: entries.sortRank })
            .from(entries)
            .where(eq(entries.type, "travelogue_session"))
            .orderBy(desc(entries.sortRank))
            .limit(1);

        const sortRank = generateKeyBetween(last?.sortRank ?? null, null);
        const [session] = await db
            .insert(entries)
            .values({
                type: "travelogue_session",
                title,
                sortRank,
                showHeading: true,
            })
            .returning();

        const createEmptyDate = req.body?.createEmptyDate !== false;
        let gameDate = null;
        if (createEmptyDate) {
            const dateKey =
                typeof req.body?.dateKey === "string" && req.body.dateKey.trim()
                    ? req.body.dateKey.trim()
                    : `session-${session.id.slice(0, 8)}`;
            const dateTitle =
                typeof req.body?.dateTitle === "string" ? req.body.dateTitle : title;
            const showHeading = Boolean(req.body?.showHeading);
            const [chunk] = await db
                .insert(entries)
                .values({
                    type: "game_date",
                    title: dateTitle,
                    parentId: session.id,
                    dateKey,
                    sortRank: generateKeyBetween(null, null),
                    showHeading,
                })
                .returning();
            gameDate = chunk;
        }

        res.status(201).json({ session, gameDate });
    } catch (err) {
        next(err);
    }
});
