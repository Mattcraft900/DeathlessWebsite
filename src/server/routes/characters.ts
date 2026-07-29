import { Router } from "express";
import { asc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { blocks, characters, entries, writers } from "../../db/schema.js";

export const charactersRouter = Router();

charactersRouter.get("/", async (_req, res, next) => {
  try {
    const rows = await db.select().from(characters).orderBy(asc(characters.sortRank));
    res.json({
      characters: rows.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        fullName: c.fullName,
        gender: c.gender,
        species: c.species,
        age: c.age,
        category: c.category,
        snippet: c.snippet,
        level: c.level,
        classes: c.classesJson ? JSON.parse(c.classesJson) : null,
        playerName: c.playerName,
      })),
    });
  } catch (err) {
    next(err);
  }
});

charactersRouter.get("/:slug", async (req, res, next) => {
  try {
    const slug = String(req.params.slug);
    const [character] = await db
      .select()
      .from(characters)
      .where(eq(characters.slug, slug))
      .limit(1);
    if (!character) {
      res.status(404).json({ error: "Character not found" });
      return;
    }

    const [bio] = await db
      .select()
      .from(entries)
      .where(eq(entries.characterId, character.id))
      .limit(1);

    let bioPayload = null;
    if (bio) {
      const bioBlocks = await db
        .select({
          id: blocks.id,
          entryId: blocks.entryId,
          writerId: blocks.writerId,
          body: blocks.body,
          sortRank: blocks.sortRank,
          writerSlug: writers.slug,
          writerCssClass: writers.cssClass,
          writerDisplayName: writers.displayName,
        })
        .from(blocks)
        .innerJoin(writers, eq(blocks.writerId, writers.id))
        .where(eq(blocks.entryId, bio.id))
        .orderBy(asc(blocks.sortRank));

      bioPayload = {
        id: bio.id,
        type: bio.type,
        version: bio.version,
        blocks: bioBlocks,
      };
    }

    res.json({
      character: {
        id: character.id,
        slug: character.slug,
        name: character.name,
        fullName: character.fullName,
        gender: character.gender,
        species: character.species,
        age: character.age,
        category: character.category,
        snippet: character.snippet,
        level: character.level,
        classes: character.classesJson ? JSON.parse(character.classesJson) : null,
        playerName: character.playerName,
        locationHome: character.locationHome,
        locationLast: character.locationLast,
      },
      bio: bioPayload,
    });
  } catch (err) {
    next(err);
  }
});
