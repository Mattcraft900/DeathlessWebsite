/**
 * Travelogue sessions API.
 * - GET /toc — flat Jump-to outline (sessions + unique dateKeys; prologue skipped
 *   as a date row — client treats it as session-only). Hidden headings are omitted.
 * - GET /sessions?limit&after — cursor pagination by session sortRank; each session
 *   includes nested game_date chunks with blocks. `nextCursor` is the last page
 *   session's sortRank (or null).
 * - POST /sessions — Lucy creates a session (+ hidden empty date chunk).
 * - POST /dates/insert — Lucy inserts a headed date at a paragraph seam.
 * - PATCH /headings/:id — Lucy renames or hides a session title / date heading.
 */
import { Router } from "express";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { db } from "../../db/index.js";
import { blocks, entries, writers } from "../../db/schema.js";
import { requireLucy, type AuthedRequest } from "../auth.js";

export const travelogueRouter = Router();

travelogueRouter.get("/toc", async (_req, res, next) => {
    try {
        const sessionRows = await db
            .select({
                id: entries.id,
                title: entries.title,
                sortRank: entries.sortRank,
                showHeading: entries.showHeading,
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
                const headed = headedByDateKey.get(chunk.dateKey);
                if (!headed) continue;
                seen.add(chunk.dateKey);
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
                showHeading: session.showHeading,
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
                        writerHandwritingColor: writers.handwritingColor,
                        writerHandwritingFont: writers.handwritingFont,
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
                showHeading: session.showHeading,
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

travelogueRouter.post("/sessions", requireLucy, async (req: AuthedRequest, res, next) => {
    try {
        const requested = typeof req.body?.title === "string" ? req.body.title.trim() : "";
        const title = requested || defaultIrlSessionTitle();

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

        const [gameDate] = await db
            .insert(entries)
            .values({
                type: "game_date",
                title: null,
                parentId: session.id,
                dateKey: `session-${session.id.slice(0, 8)}`,
                sortRank: generateKeyBetween(null, null),
                showHeading: false,
            })
            .returning();

        res.status(201).json({
            session: {
                id: session.id,
                type: session.type,
                title: session.title,
                sortRank: session.sortRank,
                showHeading: session.showHeading,
                gameDates: [await loadGameDateView(gameDate.id)],
            },
        });
    } catch (err) {
        next(err);
    }
});

travelogueRouter.post("/dates/insert", requireLucy, async (req: AuthedRequest, res, next) => {
    try {
        const entryId = typeof req.body?.entryId === "string" ? req.body.entryId : "";
        const beforeSortRank =
            typeof req.body?.beforeSortRank === "string" && req.body.beforeSortRank
                ? req.body.beforeSortRank
                : null;
        if (!entryId) {
            res.status(400).json({ error: "entryId is required" });
            return;
        }

        const [chunk] = await db.select().from(entries).where(eq(entries.id, entryId)).limit(1);
        if (!chunk || chunk.type !== "game_date" || !chunk.parentId) {
            res.status(404).json({ error: "Date chunk not found" });
            return;
        }

        const siblings = await db
            .select()
            .from(entries)
            .where(and(eq(entries.type, "game_date"), eq(entries.parentId, chunk.parentId)))
            .orderBy(asc(entries.sortRank));

        const chunkBlocks = await db
            .select()
            .from(blocks)
            .where(eq(blocks.entryId, chunk.id))
            .orderBy(asc(blocks.sortRank));

        const siblingIds = siblings.map((row) => row.id);
        const siblingBlocks = siblingIds.length
            ? await db
                  .select({ id: blocks.id })
                  .from(blocks)
                  .where(inArray(blocks.entryId, siblingIds))
            : [];
        const sessionHasProse = siblingBlocks.length > 0;

        if (!beforeSortRank) {
            if (!sessionHasProse && !chunk.showHeading) {
                const revived = await reviveDate(chunk);
                res.status(201).json({
                    mode: "promote",
                    source: revived,
                    gameDate: revived,
                });
                return;
            }

        const index = siblings.findIndex((row) => row.id === chunk.id);
        const next = index >= 0 ? siblings[index + 1] : undefined;
        if (next && !next.showHeading) {
            const revived = await reviveDate(next);
            res.status(201).json({
                mode: "revive",
                place: "after",
                source: await loadGameDateView(chunk.id),
                gameDate: revived,
            });
            return;
        }
        const [created] = await db
            .insert(entries)
            .values({
                type: "game_date",
                title: "New date",
                parentId: chunk.parentId,
                dateKey: `date-${chunk.id.slice(0, 8)}-${Date.now()}`,
                sortRank: generateKeyBetween(chunk.sortRank, next?.sortRank ?? null),
                showHeading: true,
            })
            .returning();
        res.status(201).json({
            mode: "append",
            source: await loadGameDateView(chunk.id),
            gameDate: await loadGameDateView(created.id),
        });
        return;
    }

        const splitAt = chunkBlocks.findIndex((block) => block.sortRank >= beforeSortRank);
        if (splitAt < 0) {
            res.status(400).json({ error: "beforeSortRank is not in this date chunk" });
            return;
        }

        const index = siblings.findIndex((row) => row.id === chunk.id);
        const previous = index > 0 ? siblings[index - 1] : undefined;
        if (splitAt === 0 && previous && !previous.showHeading) {
            const previousBlocks = await db
                .select({ id: blocks.id })
                .from(blocks)
                .where(eq(blocks.entryId, previous.id))
                .limit(1);
            if (previousBlocks.length === 0) {
                const revived = await reviveDate(previous);
                res.status(201).json({
                    mode: "revive",
                    place: "before",
                    source: await loadGameDateView(chunk.id),
                    gameDate: revived,
                });
                return;
            }
        }

        const moving = chunkBlocks.slice(splitAt);
        const next = index >= 0 ? siblings[index + 1] : undefined;
        const created = await db.transaction(async (tx) => {
            const [row] = await tx
                .insert(entries)
                .values({
                    type: "game_date",
                    title: "New date",
                    parentId: chunk.parentId,
                    dateKey: `date-${chunk.id.slice(0, 8)}-${Date.now()}`,
                    sortRank: generateKeyBetween(chunk.sortRank, next?.sortRank ?? null),
                    showHeading: true,
                })
                .returning();
            await tx
                .update(blocks)
                .set({ entryId: row.id, updatedAt: new Date() })
                .where(
                    inArray(
                        blocks.id,
                        moving.map((block) => block.id),
                    ),
                );
            return row;
        });

        res.status(201).json({
            mode: "split",
            source: await loadGameDateView(chunk.id),
            gameDate: await loadGameDateView(created.id),
        });
    } catch (err) {
        next(err);
    }
});

travelogueRouter.patch("/headings/:id", requireLucy, async (req: AuthedRequest, res, next) => {
    try {
        const id = String(req.params.id);
        const [entry] = await db.select().from(entries).where(eq(entries.id, id)).limit(1);
        if (!entry || (entry.type !== "travelogue_session" && entry.type !== "game_date")) {
            res.status(404).json({ error: "Heading not found" });
            return;
        }

        const patch: {
            title?: string;
            showHeading?: boolean;
            dateKey?: string;
            updatedAt: Date;
        } = { updatedAt: new Date() };

        if (typeof req.body?.title === "string") {
            const title = req.body.title.trim();
            if (!title) {
                res.status(400).json({ error: "title cannot be empty" });
                return;
            }
            patch.title = title;
            if (entry.type === "game_date") {
                patch.dateKey = parseInGameDateKey(title) ?? syntheticDateKey(entry.id);
            }
        }

        if (typeof req.body?.showHeading === "boolean") {
            patch.showHeading = req.body.showHeading;
        }

        if (patch.title === undefined && patch.showHeading === undefined) {
            res.status(400).json({ error: "Nothing to update" });
            return;
        }

        const hideDate = entry.type === "game_date" && patch.showHeading === false && entry.showHeading;
        let previousView = null;
        if (hideDate && entry.parentId) {
            const siblings = await db
                .select()
                .from(entries)
                .where(and(eq(entries.type, "game_date"), eq(entries.parentId, entry.parentId)))
                .orderBy(asc(entries.sortRank));
            const index = siblings.findIndex((row) => row.id === entry.id);
            const previous = index > 0 ? siblings[index - 1] : undefined;
            if (previous) {
                await db.transaction(async (tx) => {
                    await appendBlocksOnto(tx, previous.id, entry.id);
                    await tx
                        .update(entries)
                        .set({ ...patch, showHeading: false })
                        .where(eq(entries.id, id));
                });
                previousView = await loadGameDateView(previous.id);
            }
        }

        const [updated] = previousView
            ? await db.select().from(entries).where(eq(entries.id, id)).limit(1)
            : await db.update(entries).set(patch).where(eq(entries.id, id)).returning();

        res.json({
            entry: {
                id: updated.id,
                type: updated.type,
                title: updated.title,
                showHeading: updated.showHeading,
                dateKey: updated.dateKey,
                parentId: updated.parentId,
            },
            previous: previousView,
        });
    } catch (err) {
        next(err);
    }
});

function defaultIrlSessionTitle(now = new Date()): string {
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const year = String(now.getFullYear()).slice(-2);
    return `${month}.${day}.${year}`;
}

function parseInGameDateKey(title: string): string | null {
    const match = title.match(/(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
    if (!match) return null;
    const month = match[1].padStart(2, "0");
    const day = match[2].padStart(2, "0");
    const year = match[3];
    return `${year}-${month}-${day}`;
}

function syntheticDateKey(id: string): string {
    return `heading-${id.slice(0, 8)}`;
}

function reviveTitle(title: string | null, sessionTitle: string | null): string {
    const trimmed = title?.trim() ?? "";
    if (!trimmed) return "New date";
    if (sessionTitle && trimmed === sessionTitle.trim()) return "New date";
    return trimmed;
}

async function reviveDate(row: typeof entries.$inferSelect) {
    const sessionTitle = row.parentId
        ? (
              await db
                  .select({ title: entries.title })
                  .from(entries)
                  .where(eq(entries.id, row.parentId))
                  .limit(1)
          )[0]?.title ?? null
        : null;
    const title = reviveTitle(row.title, sessionTitle);
    await db
        .update(entries)
        .set({
            title,
            showHeading: true,
            dateKey: parseInGameDateKey(title) ?? syntheticDateKey(row.id),
            updatedAt: new Date(),
        })
        .where(eq(entries.id, row.id));
    return loadGameDateView(row.id);
}

async function appendBlocksOnto(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    targetId: string,
    fromId: string,
) {
    const existing = await tx
        .select({ sortRank: blocks.sortRank })
        .from(blocks)
        .where(eq(blocks.entryId, targetId))
        .orderBy(asc(blocks.sortRank));
    const moving = await tx
        .select()
        .from(blocks)
        .where(eq(blocks.entryId, fromId))
        .orderBy(asc(blocks.sortRank));
    if (!moving.length) return;

    let prevRank = existing[existing.length - 1]?.sortRank ?? null;
    for (let i = 0; i < moving.length; i++) {
        const sortRank = generateKeyBetween(prevRank, null);
        await tx
            .update(blocks)
            .set({
                entryId: targetId,
                sortRank,
                startsParagraph: i === 0 ? existing.length > 0 : moving[i].startsParagraph,
                updatedAt: new Date(),
            })
            .where(eq(blocks.id, moving[i].id));
        prevRank = sortRank;
    }
}

async function loadGameDateView(id: string) {
    const [chunk] = await db.select().from(entries).where(eq(entries.id, id)).limit(1);
    if (!chunk) return null;

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
            writerHandwritingColor: writers.handwritingColor,
            writerHandwritingFont: writers.handwritingFont,
        })
        .from(blocks)
        .innerJoin(writers, eq(blocks.writerId, writers.id))
        .where(eq(blocks.entryId, chunk.id))
        .orderBy(asc(blocks.sortRank));

    return {
        id: chunk.id,
        type: chunk.type,
        title: chunk.title,
        dateKey: chunk.dateKey,
        showHeading: chunk.showHeading,
        version: chunk.version,
        sortRank: chunk.sortRank,
        blocks: chunkBlocks,
    };
}
