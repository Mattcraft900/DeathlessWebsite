import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const entryTypeEnum = pgEnum("entry_type", [
  "travelogue_session",
  "game_date",
  "character_bio",
]);

export const writers = pgTable("writers", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  pinHash: text("pin_hash").notNull(),
  cssClass: text("css_class").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const characters = pgTable("characters", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  fullName: text("full_name").notNull(),
  gender: text("gender"),
  species: text("species"),
  age: text("age"),
  category: text("category").notNull().default("npc"),
  snippet: text("snippet"),
  writerId: uuid("writer_id").references(() => writers.id),
  level: integer("level"),
  classesJson: text("classes_json"),
  playerName: text("player_name"),
  locationHome: text("location_home"),
  locationLast: text("location_last"),
  // COLLATE "C" in DB — fractional ranks must use byte order, not locale
  sortRank: text("sort_rank").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const entries = pgTable("entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: entryTypeEnum("type").notNull(),
  title: text("title"),
  parentId: uuid("parent_id"),
  characterId: uuid("character_id").references(() => characters.id),
  dateKey: text("date_key"),
  // COLLATE "C" in DB — fractional ranks must use byte order, not locale
  sortRank: text("sort_rank").notNull(),
  showHeading: boolean("show_heading").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const blocks = pgTable("blocks", {
  id: uuid("id").defaultRandom().primaryKey(),
  entryId: uuid("entry_id")
    .notNull()
    .references(() => entries.id, { onDelete: "cascade" }),
  writerId: uuid("writer_id")
    .notNull()
    .references(() => writers.id),
  body: text("body").notNull(), // edge-trimmed; inter-block spaces are client-only
  // First block of a visual paragraph (client inserts .entry-para-break before it)
  startsParagraph: boolean("starts_paragraph").notNull().default(false),
  // COLLATE "C" in DB — fractional ranks must use byte order, not locale
  sortRank: text("sort_rank").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Writer = typeof writers.$inferSelect;
export type Character = typeof characters.$inferSelect;
export type Entry = typeof entries.$inferSelect;
export type Block = typeof blocks.$inferSelect;
