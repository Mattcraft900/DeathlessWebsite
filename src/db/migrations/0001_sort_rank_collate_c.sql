-- Fractional-indexing keys must sort as raw byte/ASCII strings (same as JS).
-- Locale collations (e.g. English_United States.1252) reorder mixed-case keys
-- like a0V vs a0l and scramble mid-block insert order after save.
ALTER TABLE "blocks" ALTER COLUMN "sort_rank" SET DATA TYPE text COLLATE "C";--> statement-breakpoint
ALTER TABLE "entries" ALTER COLUMN "sort_rank" SET DATA TYPE text COLLATE "C";--> statement-breakpoint
ALTER TABLE "characters" ALTER COLUMN "sort_rank" SET DATA TYPE text COLLATE "C";
