/**
 * Append travelogue sessions from JSON that are not already present
 * (matched by session title). Does NOT wipe existing data.
 *
 * Usage:
 *   npx tsx scripts/append-travelogue-session.ts
 *   npx tsx scripts/append-travelogue-session.ts --stress
 *   npx tsx scripts/append-travelogue-session.ts --file=scripts/data/foo.json
 *   npx tsx scripts/append-travelogue-session.ts --title=Session Title Here
 *   npx tsx scripts/append-travelogue-session.ts --delete-title=Session Title Here
 *   npx tsx scripts/append-travelogue-session.ts --delete-stress
 *
 * Points at whatever DATABASE_URL is in .env (local or Neon).
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, desc, eq, inArray } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { db, pool } from "../src/db/index.js";
import { blocks, entries, writers } from "../src/db/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = resolve(__dirname, "data/travelogue.json");
const STRESS_FILE = resolve(__dirname, "data/travelogue-stress.json");

type TravelogueSession = {
    session_date: string;
    content: { game_date: string | null; text: string[] }[];
};

function parseDateKey(
    gameDate: string | null,
    sessionDate: string,
): { dateKey: string | null; showHeading: boolean; title: string | null } {
    if (sessionDate === "Prologue" && (!gameDate || !gameDate.trim())) {
        return { dateKey: "prologue", showHeading: false, title: "Prologue" };
    }
    if (!gameDate || !gameDate.trim()) {
        return { dateKey: null, showHeading: false, title: null };
    }
    const match = gameDate.match(/(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
    if (match) {
        const month = match[1].padStart(2, "0");
        const day = match[2].padStart(2, "0");
        const year = match[3];
        return {
            dateKey: `${year}-${month}-${day}`,
            showHeading: true,
            title: gameDate,
        };
    }
    return {
        dateKey: gameDate.toLowerCase().replace(/\s+/g, "-"),
        showHeading: true,
        title: gameDate,
    };
}

function parseVoiceBlocks(text: string): { writerSlug: "lucy" | "nemah"; body: string }[] {
    const rawParts: { writerSlug: "lucy" | "nemah"; body: string }[] = [];
    const regex = /<([^>]+)>/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
        const before = text.slice(lastIndex, match.index).trim();
        if (before) rawParts.push({ writerSlug: "lucy", body: before });
        const nemahText = match[1].trim();
        if (nemahText) rawParts.push({ writerSlug: "nemah", body: nemahText });
        lastIndex = regex.lastIndex;
    }

    const after = text.slice(lastIndex).trim();
    if (after) rawParts.push({ writerSlug: "lucy", body: after });

    const merged: { writerSlug: "lucy" | "nemah"; body: string }[] = [];
    for (const part of rawParts) {
        const prev = merged[merged.length - 1];
        if (prev && prev.writerSlug === part.writerSlug) {
            prev.body = `${prev.body} ${part.body}`;
        } else {
            merged.push({ ...part });
        }
    }
    return merged.filter((p) => p.body.length > 0);
}

function blocksFromParagraphs(
    paragraphs: string[],
): { writerSlug: "lucy" | "nemah"; body: string; startsParagraph: boolean }[] {
    const result: { writerSlug: "lucy" | "nemah"; body: string; startsParagraph: boolean }[] = [];
    let isFirstParagraph = true;
    for (const paragraph of paragraphs) {
        if (!paragraph.trim()) continue;
        const parts = parseVoiceBlocks(paragraph);
        if (parts.length === 0) continue;
        for (let i = 0; i < parts.length; i++) {
            result.push({
                writerSlug: parts[i].writerSlug,
                body: parts[i].body,
                startsParagraph: i === 0 && !isFirstParagraph,
            });
        }
        isFirstParagraph = false;
    }
    return result;
}

function rankSequence(count: number, after: string | null = null): string[] {
    const ranks: string[] = [];
    let prev = after;
    for (let i = 0; i < count; i++) {
        const next = generateKeyBetween(prev, null);
        ranks.push(next);
        prev = next;
    }
    return ranks;
}

/** Supports `--flag=value` (preferred on PowerShell) or `--flag value`. */
function parseFlagValue(argv: string[], name: string): string | null {
    const prefix = `--${name}=`;
    const inline = argv.find((a) => a.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);
    const idx = argv.indexOf(`--${name}`);
    if (idx === -1) return null;
    return argv[idx + 1] ?? null;
}

function dbHostHint(url: string | undefined): string {
    if (!url) return "(DATABASE_URL not set)";
    try {
        const u = new URL(url);
        const host = u.hostname;
        const port = u.port ? `:${u.port}` : "";
        if (host === "127.0.0.1" || host === "localhost") return `local ${host}${port}`;
        if (host.includes("neon.tech")) return `Neon (${host})`;
        return host + port;
    } catch {
        return "(unparseable DATABASE_URL)";
    }
}

function loadSessionsFile(path: string): TravelogueSession[] {
    const raw = JSON.parse(readFileSync(path, "utf8")) as TravelogueSession[];
    if (!Array.isArray(raw)) {
        throw new Error(`Expected an array in ${path}`);
    }
    return raw;
}

function resolveSessionsPath(argv: string[]): string {
    if (argv.includes("--stress")) return STRESS_FILE;
    const file = parseFlagValue(argv, "file");
    if (file) return resolve(process.cwd(), file);
    return DEFAULT_FILE;
}

async function deleteSessionByTitle(title: string): Promise<boolean> {
    const sessions = await db
        .select({ id: entries.id, title: entries.title })
        .from(entries)
        .where(and(eq(entries.type, "travelogue_session"), eq(entries.title, title)));

    if (sessions.length === 0) {
        console.log(`No session to delete: ${title}`);
        return false;
    }

    for (const session of sessions) {
        const dateChildren = await db
            .select({ id: entries.id })
            .from(entries)
            .where(and(eq(entries.type, "game_date"), eq(entries.parentId, session.id)));

        const dateIds = dateChildren.map((d) => d.id);
        if (dateIds.length > 0) {
            await db.delete(blocks).where(inArray(blocks.entryId, dateIds));
            await db.delete(entries).where(inArray(entries.id, dateIds));
        }
        await db.delete(entries).where(eq(entries.id, session.id));
        console.log(`Deleted session: ${title} (${dateIds.length} date chunk(s))`);
    }
    return true;
}

async function appendSession(
    session: TravelogueSession,
    lucyId: string,
    nemahId: string,
    sessionPrevRank: string | null,
    lastDateKey: string | null,
): Promise<{ sessionRank: string; lastDateKey: string | null }> {
    const sessionRank = generateKeyBetween(sessionPrevRank, null);

    const [sessionEntry] = await db
        .insert(entries)
        .values({
            type: "travelogue_session",
            title: session.session_date,
            sortRank: sessionRank,
            showHeading: true,
        })
        .returning({ id: entries.id });

    let datePrevRank: string | null = null;
    let carriedDateKey = lastDateKey;

    for (const item of session.content) {
        const parsed = parseDateKey(item.game_date, session.session_date);
        let dateKey = parsed.dateKey;
        let showHeading = parsed.showHeading;
        let title = parsed.title;

        if (dateKey === null && carriedDateKey) {
            dateKey = carriedDateKey;
            showHeading = false;
            title = null;
        } else if (dateKey) {
            carriedDateKey = dateKey;
        }

        const dateRank = generateKeyBetween(datePrevRank, null);
        datePrevRank = dateRank;

        const [dateEntry] = await db
            .insert(entries)
            .values({
                type: "game_date",
                title,
                parentId: sessionEntry.id,
                dateKey,
                sortRank: dateRank,
                showHeading,
            })
            .returning({ id: entries.id });

        const voiceBlocks = blocksFromParagraphs(item.text);
        if (voiceBlocks.length > 0) {
            const blockRanks = rankSequence(voiceBlocks.length);
            await db.insert(blocks).values(
                voiceBlocks.map((b, idx) => ({
                    entryId: dateEntry.id,
                    writerId: b.writerSlug === "nemah" ? nemahId : lucyId,
                    body: b.body,
                    startsParagraph: b.startsParagraph,
                    sortRank: blockRanks[idx],
                })),
            );
        }
    }

    return { sessionRank, lastDateKey: carriedDateKey };
}

async function main() {
    const argv = process.argv.slice(2);
    const titleFilter = parseFlagValue(argv, "title");
    const deleteTitle = parseFlagValue(argv, "delete-title");
    const deleteContains = parseFlagValue(argv, "delete-title-contains");
    const deleteStress = argv.includes("--delete-stress");
    const sessionsPath = resolveSessionsPath(argv);

    console.log(`Target DB: ${dbHostHint(process.env.DATABASE_URL)}`);

    if (deleteStress) {
        const stressSessions = loadSessionsFile(STRESS_FILE);
        let removed = 0;
        for (const session of stressSessions) {
            if (await deleteSessionByTitle(session.session_date)) removed++;
        }
        console.log(`Stress cleanup done. Removed ${removed} session(s).`);
        // Default: delete only. Pass --stress or --append-after-delete to also append.
        if (!argv.includes("--append-after-delete") && !argv.includes("--stress") && !titleFilter) {
            return;
        }
    }

    if (deleteTitle) {
        await deleteSessionByTitle(deleteTitle);
    }

    if (deleteContains) {
        const matches = await db
            .select({ title: entries.title })
            .from(entries)
            .where(eq(entries.type, "travelogue_session"));
        for (const row of matches) {
            if (row.title && row.title.includes(deleteContains)) {
                await deleteSessionByTitle(row.title);
            }
        }
    }

    if (
        (deleteTitle || deleteContains) &&
        !deleteStress &&
        !argv.includes("--append-after-delete") &&
        !titleFilter &&
        !argv.includes("--stress")
    ) {
        return;
    }

    console.log(`Source: ${sessionsPath}`);
    const allSessions = loadSessionsFile(sessionsPath);
    const candidates = titleFilter
        ? allSessions.filter((s) => s.session_date === titleFilter)
        : allSessions;

    if (titleFilter && candidates.length === 0) {
        console.error(`No session in ${sessionsPath} with title:\n  ${titleFilter}`);
        process.exit(1);
    }

    const writerRows = await db
        .select({ id: writers.id, slug: writers.slug })
        .from(writers)
        .where(eq(writers.slug, "lucy"));
    const nemahRows = await db
        .select({ id: writers.id, slug: writers.slug })
        .from(writers)
        .where(eq(writers.slug, "nemah"));

    const lucyId = writerRows[0]?.id;
    const nemahId = nemahRows[0]?.id;
    if (!lucyId || !nemahId) {
        console.error("Missing lucy/nemah writers — run a full seed first.");
        process.exit(1);
    }

    const existingSessions = await db
        .select({ title: entries.title, sortRank: entries.sortRank })
        .from(entries)
        .where(eq(entries.type, "travelogue_session"))
        .orderBy(desc(entries.sortRank));

    const existingTitles = new Set(
        existingSessions.map((s) => s.title).filter((t): t is string => Boolean(t)),
    );

    const [lastSession] = existingSessions;
    let sessionPrevRank = lastSession?.sortRank ?? null;

    const lastHeadedDate = await db
        .select({ dateKey: entries.dateKey })
        .from(entries)
        .where(and(eq(entries.type, "game_date"), eq(entries.showHeading, true)))
        .orderBy(desc(entries.sortRank))
        .limit(1);

    let lastDateKey: string | null = null;
    if (lastSession) {
        const lastSessionRow = await db
            .select({ id: entries.id })
            .from(entries)
            .where(
                and(
                    eq(entries.type, "travelogue_session"),
                    eq(entries.sortRank, lastSession.sortRank),
                ),
            )
            .limit(1);
        if (lastSessionRow[0]) {
            const dateChildren = await db
                .select({ dateKey: entries.dateKey })
                .from(entries)
                .where(
                    and(
                        eq(entries.type, "game_date"),
                        eq(entries.parentId, lastSessionRow[0].id),
                    ),
                )
                .orderBy(desc(entries.sortRank))
                .limit(1);
            lastDateKey = dateChildren[0]?.dateKey ?? lastHeadedDate[0]?.dateKey ?? null;
        }
    } else {
        lastDateKey = lastHeadedDate[0]?.dateKey ?? null;
    }

    let appended = 0;
    let skipped = 0;

    for (const session of candidates) {
        if (existingTitles.has(session.session_date)) {
            console.log(`Skip (already present): ${session.session_date}`);
            skipped++;
            continue;
        }

        const result = await appendSession(
            session,
            lucyId,
            nemahId,
            sessionPrevRank,
            lastDateKey,
        );
        sessionPrevRank = result.sessionRank;
        lastDateKey = result.lastDateKey;
        existingTitles.add(session.session_date);
        appended++;
        console.log(`Appended: ${session.session_date} (${session.content.length} date chunk(s))`);
    }

    console.log(`Done. Appended ${appended}, skipped ${skipped}.`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .finally(async () => {
        await pool.end();
    });
