/**
 * Fractional indexing helpers for insert-between ordering without renumbering
 * the whole list. DB columns use COLLATE "C" so string order matches byte order.
 */
import { generateKeyBetween } from "fractional-indexing";

/** Generate n evenly spaced fractional ranks starting after `after` (or from scratch). */
export function rankSequence(count: number, after: string | null = null): string[] {
  const ranks: string[] = [];
  let prev = after;
  for (let i = 0; i < count; i++) {
    const next = generateKeyBetween(prev, null);
    ranks.push(next);
    prev = next;
  }
  return ranks;
}

export function rankBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after);
}
