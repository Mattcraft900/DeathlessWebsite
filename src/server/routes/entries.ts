/**
 * Entry + block API. GET returns an entry with ordered blocks.
 * PUT /:id/blocks is optimistic concurrency: client sends expected `version`;
 * mismatch → 409 with fresh `{ entry }` so the client can 3-way merge and retry.
 *
 * Non-admins may only edit/delete their own blocks, except the mid-split
 * commentary case: shortening a foreign block to a prefix/suffix and inserting
 * a same-author continuation (no id) in the same payload.
 * Bodies are trimmed on write; `startsParagraph` is stored per block.
 */
import { Router } from "express";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { blocks, entries, writers } from "../../db/schema.js";
import { requireWriter, type AuthedRequest } from "../auth.js";

export const entriesRouter = Router();

type IncomingBlock = {
    id?: string;
    writerId: string;
    sortRank: string;
    body: string;
    startsParagraph?: boolean;
};

const blockSelect = {
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
};

entriesRouter.get("/:id", async (req, res, next) => {
    try {
        const entryId = String(req.params.id);
        const [entry] = await db.select().from(entries).where(eq(entries.id, entryId)).limit(1);
        if (!entry) {
            res.status(404).json({ error: "Entry not found" });
            return;
        }
        const entryBlocks = await db
            .select(blockSelect)
            .from(blocks)
            .innerJoin(writers, eq(blocks.writerId, writers.id))
            .where(eq(blocks.entryId, entry.id))
            .orderBy(asc(blocks.sortRank));

        res.json({ entry: { ...entry, blocks: entryBlocks } });
    } catch (err) {
        next(err);
    }
});

entriesRouter.put("/:id/blocks", requireWriter, async (req: AuthedRequest, res, next) => {
    try {
        const entryId = String(req.params.id);
        const version = Number(req.body?.version);
        const incoming = (req.body?.blocks ?? []) as IncomingBlock[];
        if (!Number.isInteger(version) || !Array.isArray(req.body?.blocks)) {
            res.status(400).json({ error: "version and blocks[] are required" });
            return;
        }

        const [entry] = await db.select().from(entries).where(eq(entries.id, entryId)).limit(1);
        if (!entry) {
            res.status(404).json({ error: "Entry not found" });
            return;
        }
        if (entry.type === "travelogue_session") {
            res.status(400).json({ error: "Sessions do not hold blocks" });
            return;
        }

        // Stale client version → return current entry for client-side mergeBlocks()
        if (entry.version !== version) {
            const freshBlocks = await db
                .select(blockSelect)
                .from(blocks)
                .innerJoin(writers, eq(blocks.writerId, writers.id))
                .where(eq(blocks.entryId, entry.id))
                .orderBy(asc(blocks.sortRank));
            res.status(409).json({
                error: "Version conflict",
                entry: { ...entry, blocks: freshBlocks },
            });
            return;
        }

        const existing = await db.select().from(blocks).where(eq(blocks.entryId, entry.id));
        const existingById = new Map(existing.map((b) => [b.id, b]));
        const writer = req.writer!;
        const isAdmin = writer.isAdmin;

        // Detect preserved-text splits: a foreign block shortened to a prefix/suffix with
        // a same-author continuation (no id) elsewhere in the payload.
        function isAllowedForeignShorten(prev: (typeof existing)[0], nextBody: string): boolean {
            if (prev.body === nextBody) return true;
            if (prev.body.startsWith(nextBody) && nextBody.length < prev.body.length) return true;
            if (prev.body.endsWith(nextBody) && nextBody.length < prev.body.length) return true;
            return false;
        }

        function remainderCovered(prev: (typeof existing)[0], kept: string): boolean {
            let remainder = "";
            if (prev.body.startsWith(kept)) remainder = prev.body.slice(kept.length);
            else if (prev.body.endsWith(kept)) remainder = prev.body.slice(0, prev.body.length - kept.length);
            else return false;
            if (!remainder) return true;
            return incoming.some(
                (b) => !b.id && b.writerId === prev.writerId && b.body.trim() === remainder.trim(),
            );
        }

        for (const block of incoming) {
            if (!block || typeof block.body !== "string" || typeof block.sortRank !== "string") {
                res.status(400).json({ error: "Each block needs body and sortRank" });
                return;
            }
            if (block.id) {
                const prev = existingById.get(block.id);
                if (!prev) {
                    res.status(400).json({ error: `Unknown block id ${block.id}` });
                    return;
                }
                if (!isAdmin && prev.writerId !== writer.id) {
                    const okShorten =
                        isAllowedForeignShorten(prev, block.body) && remainderCovered(prev, block.body);
                    if (!okShorten || block.writerId !== prev.writerId) {
                        res.status(403).json({ error: "Cannot alter another writer's block" });
                        return;
                    }
                }
                if (!isAdmin && block.writerId !== writer.id && block.writerId !== prev.writerId) {
                    res.status(403).json({ error: "Cannot reassign block authorship" });
                    return;
                }
            } else if (!isAdmin && block.writerId !== writer.id) {
                // Allow creating a continuation of a foreign voice when that voice was
                // shortened in this same save (mid-block insert split).
                const parent = incoming.find(
                    (b) =>
                        b.id &&
                        existingById.get(b.id)?.writerId === block.writerId &&
                        isAllowedForeignShorten(existingById.get(b.id)!, b.body),
                );
                if (!parent) {
                    res.status(403).json({ error: "New blocks must use your writer id" });
                    return;
                }
            }
        }

        const incomingIds = new Set(incoming.filter((b) => b.id).map((b) => b.id!));
        for (const prev of existing) {
            if (!incomingIds.has(prev.id)) {
                if (!isAdmin && prev.writerId !== writer.id) {
                    res.status(403).json({ error: "Cannot delete another writer's block" });
                    return;
                }
            }
        }
        await db.transaction(async (tx) => {
            const toDelete = existing.filter((b) => !incomingIds.has(b.id));
            for (const b of toDelete) {
                await tx.delete(blocks).where(eq(blocks.id, b.id));
            }

            for (const block of incoming) {
                const body = block.body.trim();
                const startsParagraph = Boolean(block.startsParagraph);
                if (block.id && existingById.has(block.id)) {
                    const prev = existingById.get(block.id)!;
                    const canEditMeta = isAdmin || prev.writerId === writer.id;
                    await tx
                        .update(blocks)
                        .set({
                            body,
                            sortRank: block.sortRank,
                            startsParagraph: canEditMeta ? startsParagraph : prev.startsParagraph,
                            writerId: isAdmin ? block.writerId : prev.writerId,
                            updatedAt: new Date(),
                        })
                        .where(eq(blocks.id, block.id));
                } else {
                    await tx.insert(blocks).values({
                        entryId: entry.id,
                        writerId: block.writerId,
                        body,
                        startsParagraph,
                        sortRank: block.sortRank,
                    });
                }
            }

            // Conditional bump: if another writer won the race, version won't match
            await tx
                .update(entries)
                .set({ version: entry.version + 1, updatedAt: new Date() })
                .where(and(eq(entries.id, entry.id), eq(entries.version, version)));
        });

        const [updated] = await db.select().from(entries).where(eq(entries.id, entry.id)).limit(1);
        // Lost the version race inside the transaction → still 409 with fresh data
        if (!updated || updated.version !== version + 1) {
            const freshBlocks = await db
                .select(blockSelect)
                .from(blocks)
                .innerJoin(writers, eq(blocks.writerId, writers.id))
                .where(eq(blocks.entryId, entry.id))
                .orderBy(asc(blocks.sortRank));
            res.status(409).json({
                error: "Version conflict",
                entry: { ...(updated ?? entry), blocks: freshBlocks },
            });
            return;
        }

        const savedBlocks = await db
            .select(blockSelect)
            .from(blocks)
            .innerJoin(writers, eq(blocks.writerId, writers.id))
            .where(eq(blocks.entryId, entry.id))
            .orderBy(asc(blocks.sortRank));

        res.json({ entry: { ...updated, blocks: savedBlocks } });
    } catch (err) {
        next(err);
    }
});
