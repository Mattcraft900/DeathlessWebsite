import { generateKeyBetween } from "fractional-indexing";
import { apiPut } from "./api.js";
import { getCurrentWriter } from "./auth-ui.js";

function getFormatMode() {
  const dropdown = document.getElementById("format-dropdown");
  return dropdown?.value === "simple" ? "simple" : "stylized";
}

export function renderEntryBlocks(container, entry, { editable = false } = {}) {
  container.innerHTML = "";
  container.classList.add("entry-blocks");
  container.dataset.entryId = entry.id;
  container.dataset.version = String(entry.version ?? 1);

  const writer = getCurrentWriter();
  const formatMode = getFormatMode();

  for (const block of entry.blocks || []) {
    const span = document.createElement("span");
    span.className = `entry-block ${block.writerCssClass} ${formatMode}`;
    span.dataset.blockId = block.id;
    span.dataset.writerId = block.writerId;
    span.dataset.sortRank = block.sortRank;
    span.textContent = block.body;

    const canEdit =
      editable && writer && (writer.isAdmin || writer.id === block.writerId);
    span.contentEditable = canEdit ? "true" : "false";

    if (canEdit) {
      wireOwnEditable(span);
    } else if (editable && writer) {
      span.tabIndex = -1;
      span.title = "Click where you want to insert your commentary";
      span.addEventListener("click", (e) => {
        e.stopPropagation();
        insertCommentaryAtPoint(span, writer, e.clientX, e.clientY);
      });
    }

    container.appendChild(span);
  }

  if (editable && writer) {
    container._editBase = {
      version: entry.version,
      blocks: (entry.blocks || []).map((b) => ({
        id: b.id,
        writerId: b.writerId,
        body: b.body,
        sortRank: b.sortRank,
        writerCssClass: b.writerCssClass,
      })),
    };

    // Ignore container "padding" clicks that started on a block (mobile Chrome
    // often retargets the delayed click onto the container after focus/layout).
    let pointerDownOnBlock = false;
    container.onpointerdown = (e) => {
      const t = e.target;
      pointerDownOnBlock =
        t instanceof Element && Boolean(t.closest(".entry-block"));
    };
    container.onclick = (e) => {
      if (e.target !== container) return;
      if (pointerDownOnBlock) {
        pointerDownOnBlock = false;
        return;
      }
      insertOwnBlockAtEnd(container, writer);
    };
  } else {
    container.onclick = null;
    container.onpointerdown = null;
    delete container._editBase;
  }
}

function isEntryBlock(el) {
  return el instanceof HTMLElement && el.classList.contains("entry-block");
}

function blockSibling(span, direction) {
  const el = direction === "prev" ? span.previousElementSibling : span.nextElementSibling;
  return isEntryBlock(el) ? el : null;
}

function isOwnEditableBlock(el, writer) {
  return isEntryBlock(el) && el.isContentEditable && el.dataset.writerId === writer.id;
}

function isBlank(el) {
  return !(el.textContent ?? "").trim();
}

function syncEmptyAttr(el) {
  if (isBlank(el)) el.dataset.empty = "true";
  else delete el.dataset.empty;
}

function isUnsavedContinuation(el, writerId) {
  return (
    isEntryBlock(el) &&
    !el.isContentEditable &&
    el.dataset.writerId === writerId &&
    !el.dataset.blockId &&
    el.dataset.splitContinuation === "1"
  );
}

/** Remove empty own blocks on blur; rejoin unused mid-split foreign halves. */
function discardIfEmpty(span) {
  if (!span.isConnected || !isBlank(span)) {
    syncEmptyAttr(span);
    return;
  }

  const prev = blockSibling(span, "prev");
  const next = blockSibling(span, "next");
  if (
    prev &&
    next &&
    prev.dataset.writerId &&
    isUnsavedContinuation(next, prev.dataset.writerId)
  ) {
    prev.textContent = `${prev.textContent ?? ""}${next.textContent ?? ""}`;
    next.remove();
    span.remove();
    return;
  }

  span.remove();
}

function wireOwnEditable(span) {
  syncEmptyAttr(span);
  span.addEventListener("input", () => syncEmptyAttr(span));
  span.addEventListener("blur", () => {
    setTimeout(() => discardIfEmpty(span), 0);
  });
}

function distanceToRect(x, y, rect) {
  const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
  const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
  return Math.hypot(dx, dy);
}

function focusBlockCaret(span, atEnd) {
  span.focus();
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  const textNode = [...span.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
  if (textNode) {
    const len = textNode.textContent?.length ?? 0;
    range.setStart(textNode, atEnd ? len : 0);
    range.collapse(true);
  } else {
    range.selectNodeContents(span);
    range.collapse(!atEnd);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Nearest character offset in a span for a client point (works when
 * caretRangeFromPoint is missing or unreliable, e.g. mobile Chrome).
 */
function offsetFromPointInSpan(span, clientX, clientY) {
  const textNode = [...span.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
  if (!textNode) return 0;
  const text = textNode.textContent ?? "";
  const len = text.length;
  if (!len) return 0;

  const range = document.createRange();
  let lo = 0;
  let hi = len;

  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    range.setStart(textNode, 0);
    range.setEnd(textNode, mid);
    const rects = range.getClientRects();
    const last = rects[rects.length - 1];
    if (!last) {
      hi = mid - 1;
      continue;
    }
    // Point is still before the end of [0, mid)
    if (clientY < last.top - 1 || (clientY <= last.bottom + 1 && clientX < last.right)) {
      hi = mid - 1;
    } else {
      lo = mid;
    }
  }

  return lo;
}

/**
 * Resolve where in a foreign block a click/tap landed.
 * Uses geometry (not caretRangeFromPoint) because mobile Chrome often fails
 * open and previously defaulted to the end of the block. Sibling-edge snap
 * only applies in the gutter — never while the tap is inside this span.
 */
function resolveClickOffset(foreignSpan, clientX, clientY) {
  const text = foreignSpan.textContent ?? "";
  if (!text) return 0;

  let offset = offsetFromPointInSpan(foreignSpan, clientX, clientY);
  offset = Math.max(0, Math.min(offset, text.length));

  const foreignDist = distanceToRect(clientX, clientY, foreignSpan.getBoundingClientRect());
  const prev = blockSibling(foreignSpan, "prev");
  const next = blockSibling(foreignSpan, "next");
  const prevDist = prev ? distanceToRect(clientX, clientY, prev.getBoundingClientRect()) : Infinity;
  const nextDist = next ? distanceToRect(clientX, clientY, next.getBoundingClientRect()) : Infinity;
  const edgeSlop = 8;

  // Only snap when closer to a neighbor than to this block (gutter taps),
  // not when tapping inside a short block that happens to sit near siblings.
  if (nextDist <= edgeSlop && nextDist < foreignDist && nextDist <= prevDist) {
    offset = text.length;
  } else if (prevDist <= edgeSlop && prevDist < foreignDist) {
    offset = 0;
  }

  return offset;
}

function insertOwnBlockAfter(afterSpan, writer) {
  const next = blockSibling(afterSpan, "next");
  if (isOwnEditableBlock(next, writer)) {
    focusBlockCaret(next, false);
    return;
  }

  const formatMode = getFormatMode();
  const span = document.createElement("span");
  span.className = `entry-block ${writer.cssClass} ${formatMode}`;
  span.dataset.writerId = writer.id;
  span.dataset.sortRank = generateKeyBetween(
    afterSpan.dataset.sortRank ?? null,
    next?.dataset.sortRank ?? null,
  );
  span.contentEditable = "true";
  span.textContent = "";
  wireOwnEditable(span);
  afterSpan.after(span);
  focusBlockCaret(span, false);
}

function insertOwnBlockBefore(beforeSpan, writer) {
  const prev = blockSibling(beforeSpan, "prev");
  if (isOwnEditableBlock(prev, writer)) {
    focusBlockCaret(prev, true);
    return;
  }

  const formatMode = getFormatMode();
  const span = document.createElement("span");
  span.className = `entry-block ${writer.cssClass} ${formatMode}`;
  span.dataset.writerId = writer.id;
  span.dataset.sortRank = generateKeyBetween(
    prev?.dataset.sortRank ?? null,
    beforeSpan.dataset.sortRank ?? null,
  );
  span.contentEditable = "true";
  span.textContent = "";
  wireOwnEditable(span);
  beforeSpan.before(span);
  focusBlockCaret(span, false);
}

/** Split a foreign block at the click point and insert an empty own-voice block between. */
function insertCommentaryAtPoint(foreignSpan, writer, clientX, clientY) {
  const text = foreignSpan.textContent ?? "";
  const offset = resolveClickOffset(foreignSpan, clientX, clientY);
  const before = text.slice(0, offset);
  const after = text.slice(offset);
  const next = blockSibling(foreignSpan, "next");
  const baseRank = foreignSpan.dataset.sortRank ?? null;
  const afterRank = next?.dataset.sortRank ?? null;

  // Edge click next to an existing own block → edit that block, don't insert again.
  if (!before.trim()) {
    const prev = blockSibling(foreignSpan, "prev");
    if (isOwnEditableBlock(prev, writer)) {
      focusBlockCaret(prev, true);
      return;
    }
  }
  if (!after.trim()) {
    if (isOwnEditableBlock(next, writer)) {
      focusBlockCaret(next, false);
      return;
    }
  }

  if (!before.trim() && !after.trim()) {
    insertOwnBlockAfter(foreignSpan, writer);
    return;
  }

  if (!before.trim()) {
    insertOwnBlockBefore(foreignSpan, writer);
    return;
  }

  if (!after.trim()) {
    insertOwnBlockAfter(foreignSpan, writer);
    return;
  }

  // Mid-split: keep before in original, insert own, then after as new foreign continuation
  foreignSpan.textContent = before;
  const midRank = generateKeyBetween(baseRank, afterRank);
  const afterOwnRank = generateKeyBetween(midRank, afterRank);
  const formatMode = getFormatMode();

  const own = document.createElement("span");
  own.className = `entry-block ${writer.cssClass} ${formatMode}`;
  own.dataset.writerId = writer.id;
  own.dataset.sortRank = midRank;
  own.contentEditable = "true";
  own.textContent = "";
  wireOwnEditable(own);

  const continuation = document.createElement("span");
  continuation.className = foreignSpan.className;
  continuation.dataset.writerId = foreignSpan.dataset.writerId;
  continuation.dataset.sortRank = afterOwnRank;
  continuation.dataset.splitContinuation = "1";
  continuation.contentEditable = "false";
  continuation.textContent = after;
  continuation.title = "Click where you want to insert your commentary";
  continuation.addEventListener("click", (e) => {
    e.stopPropagation();
    insertCommentaryAtPoint(continuation, writer, e.clientX, e.clientY);
  });

  foreignSpan.after(own, continuation);
  focusBlockCaret(own, false);
}

function insertOwnBlockAtEnd(container, writer) {
  const last = container.querySelector(".entry-block:last-of-type");
  if (isOwnEditableBlock(last, writer)) {
    focusBlockCaret(last, true);
    return;
  }

  const formatMode = getFormatMode();
  const span = document.createElement("span");
  span.className = `entry-block ${writer.cssClass} ${formatMode}`;
  span.dataset.writerId = writer.id;
  span.dataset.sortRank = generateKeyBetween(last?.dataset.sortRank ?? null, null);
  span.contentEditable = "true";
  span.textContent = "";
  wireOwnEditable(span);
  container.appendChild(span);
  focusBlockCaret(span, false);
}

function gatherBlocksFromDom(container) {
  const writer = getCurrentWriter();
  if (!writer) return [];

  const blocks = [];
  let prevRank = null;

  for (const node of container.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (!text) continue;
      const sortRank = generateKeyBetween(prevRank, null);
      blocks.push({
        writerId: writer.id,
        body: text,
        sortRank,
      });
      prevRank = sortRank;
      continue;
    }

    if (!(node instanceof HTMLElement) || !node.classList.contains("entry-block")) {
      continue;
    }

    const body = node.textContent ?? "";
    if (!body.trim() && !node.dataset.blockId) continue;

    const sortRank =
      node.dataset.sortRank || generateKeyBetween(prevRank, null);
    blocks.push({
      id: node.dataset.blockId || undefined,
      writerId: node.dataset.writerId,
      body,
      sortRank,
    });
    prevRank = sortRank;
  }

  return mergeAdjacentSameWriter(blocks);
}

function mergeAdjacentSameWriter(blocks) {
  const merged = [];
  for (const block of blocks) {
    const prev = merged[merged.length - 1];
    // Only fold brand-new adjacent runs of the same voice (no persisted ids yet)
    if (prev && prev.writerId === block.writerId && !prev.id && !block.id) {
      prev.body = `${prev.body}${block.body}`;
      prev.sortRank = block.sortRank;
    } else {
      merged.push({ ...block });
    }
  }
  return merged;
}

function clonePayloadBlock(b) {
  const out = {
    writerId: b.writerId,
    body: b.body,
    sortRank: b.sortRank,
  };
  if (b.id) out.id = b.id;
  return out;
}

function indexBlocksById(blocks) {
  const map = new Map();
  for (const b of blocks) {
    if (b.id) map.set(b.id, b);
  }
  return map;
}

function rerankBlocks(blocks) {
  let prev = null;
  return blocks.map((b) => {
    const sortRank = generateKeyBetween(prev, null);
    prev = sortRank;
    return { ...b, sortRank };
  });
}

function isForeignShorten(baseBody, nextBody) {
  if (baseBody === nextBody) return false;
  if (baseBody.startsWith(nextBody) && nextBody.length < baseBody.length) return true;
  if (baseBody.endsWith(nextBody) && nextBody.length < baseBody.length) return true;
  return false;
}

function foreignRemainder(baseBody, keptBody) {
  if (baseBody.startsWith(keptBody) && keptBody.length < baseBody.length) {
    return baseBody.slice(keptBody.length);
  }
  if (baseBody.endsWith(keptBody) && keptBody.length < baseBody.length) {
    return baseBody.slice(0, baseBody.length - keptBody.length);
  }
  return "";
}

/** True if the split remainder already exists after the shortened prefix on remote. */
function hasContinuationAfter(result, afterId, remainder, foreignWriterId) {
  if (!remainder) return false;
  const idx = result.findIndex((r) => r.id === afterId);
  if (idx < 0) return false;
  for (let j = idx + 1; j < result.length; j++) {
    const b = result[j];
    if (b.writerId === foreignWriterId && b.body === remainder) return true;
  }
  return false;
}

/**
 * 3-way merge for concurrent saves: start from remote, overlay this writer's
 * deletions/updates/splits/inserts from local relative to base.
 */
function mergeBlocks(base, local, remote, writerId) {
  const baseArr = base || [];
  const remoteArr = remote || [];
  const baseById = indexBlocksById(baseArr);
  const localById = indexBlocksById(local);
  const remoteById = indexBlocksById(remoteArr);
  const isAdmin = Boolean(getCurrentWriter()?.isAdmin);

  let result = remoteArr.map(clonePayloadBlock);

  const deletedIds = new Set();
  for (const b of baseArr) {
    if (b.id && b.writerId === writerId && !localById.has(b.id)) {
      deletedIds.add(b.id);
    }
  }
  result = result.filter((b) => !(b.id && deletedIds.has(b.id)));

  for (const b of local) {
    if (!b.id) continue;
    const target = result.find((r) => r.id === b.id);
    if (!target) continue;
    if (target.writerId === writerId) {
      target.body = b.body;
    } else if (isAdmin) {
      const baseBlock = baseById.get(b.id);
      if (baseBlock && b.body !== baseBlock.body) {
        target.body = b.body;
      }
    }
  }

  // Apply compatible foreign shortens (mid-split prefix still untouched on remote)
  for (const b of local) {
    if (!b.id) continue;
    const baseBlock = baseById.get(b.id);
    if (!baseBlock || baseBlock.writerId === writerId) continue;
    if (!isForeignShorten(baseBlock.body, b.body)) continue;
    const remoteBlock = remoteById.get(b.id);
    const target = result.find((r) => r.id === b.id);
    if (target && remoteBlock && remoteBlock.body === baseBlock.body) {
      target.body = b.body;
    }
  }

  // Insert no-id runs from local using surviving id anchors
  const insertOps = [];
  let i = 0;
  while (i < local.length) {
    if (local[i].id) {
      i += 1;
      continue;
    }

    const run = [];
    while (i < local.length && !local[i].id) {
      run.push(clonePayloadBlock(local[i]));
      i += 1;
    }

    let afterId = null;
    for (let k = i - run.length - 1; k >= 0; k--) {
      if (local[k].id && result.some((r) => r.id === local[k].id)) {
        afterId = local[k].id;
        break;
      }
    }

    let beforeId = null;
    if (i < local.length && local[i].id && result.some((r) => r.id === local[i].id)) {
      beforeId = local[i].id;
    }

    let blocksToInsert = run;
    if (afterId) {
      const baseBlock = baseById.get(afterId);
      const localParent = localById.get(afterId);
      const remoteBlock = remoteById.get(afterId);
      const target = result.find((r) => r.id === afterId);
      if (
        baseBlock &&
        localParent &&
        baseBlock.writerId !== writerId &&
        isForeignShorten(baseBlock.body, localParent.body)
      ) {
        const remainder = foreignRemainder(baseBlock.body, localParent.body);
        // Only this merge shortened a still-intact remote block → keep foreign continuation.
        // If another writer already split the same place, skip re-inserting the second half.
        const shortenedHere =
          Boolean(remoteBlock && remoteBlock.body === baseBlock.body && target?.body === localParent.body);
        const contAlreadyThere = hasContinuationAfter(
          result,
          afterId,
          remainder,
          baseBlock.writerId,
        );
        if (!shortenedHere || contAlreadyThere) {
          blocksToInsert = run.filter((x) => x.writerId === writerId);
        }
      }
    }

    if (blocksToInsert.length) {
      insertOps.push({ afterId, beforeId, blocks: blocksToInsert });
    }
  }

  // Apply inserts in local order without reversing when multiple runs share an anchor
  const afterBatches = new Map();
  const beforeBatches = new Map();
  const appendBlocks = [];

  for (const op of insertOps) {
    const blocks = op.blocks.map(clonePayloadBlock);
    if (op.afterId && result.some((r) => r.id === op.afterId)) {
      const list = afterBatches.get(op.afterId) || [];
      list.push(...blocks);
      afterBatches.set(op.afterId, list);
    } else if (op.beforeId && result.some((r) => r.id === op.beforeId)) {
      const list = beforeBatches.get(op.beforeId) || [];
      list.push(...blocks);
      beforeBatches.set(op.beforeId, list);
    } else {
      appendBlocks.push(...blocks);
    }
  }

  const rebuilt = [];
  for (const b of result) {
    if (b.id && beforeBatches.has(b.id)) {
      rebuilt.push(...beforeBatches.get(b.id));
      beforeBatches.delete(b.id);
    }
    rebuilt.push(b);
    if (b.id && afterBatches.has(b.id)) {
      rebuilt.push(...afterBatches.get(b.id));
    }
  }
  for (const leftover of beforeBatches.values()) {
    rebuilt.unshift(...leftover);
  }
  rebuilt.push(...appendBlocks);
  result = rebuilt;

  return mergeAdjacentSameWriter(rerankBlocks(result));
}

const MAX_CONFLICT_RETRIES = 5;

function voiceClassFromEl(el) {
  for (const cls of el.classList) {
    if (cls.startsWith("voice-")) return cls;
  }
  return "";
}

/** Snapshot entry blocks from the DOM for re-render (includes voice CSS class). */
function snapshotBlocksFromDom(container) {
  const blocks = [];
  for (const node of container.children) {
    if (!(node instanceof HTMLElement) || !node.classList.contains("entry-block")) {
      continue;
    }
    blocks.push({
      id: node.dataset.blockId || undefined,
      writerId: node.dataset.writerId,
      body: node.textContent ?? "",
      sortRank: node.dataset.sortRank,
      writerCssClass: voiceClassFromEl(node),
    });
  }
  return blocks;
}

function entryFromContainer(container) {
  return {
    id: container.dataset.entryId,
    version: Number(container.dataset.version || 1),
    blocks: snapshotBlocksFromDom(container),
  };
}

/**
 * Re-render every entry container under root as editable or read-only,
 * preserving current DOM text when switching modes.
 */
export function setAllEntriesEditable(root = document, editable = false) {
  root.querySelectorAll(".entry-blocks[data-entry-id]").forEach((container) => {
    renderEntryBlocks(container, entryFromContainer(container), { editable });
  });
}

/** Restore each editable container from its `_editBase` snapshot (read-only). */
export function discardAllEntryBlocks(root = document) {
  root.querySelectorAll(".entry-blocks[data-entry-id]").forEach((container) => {
    const base = container._editBase;
    if (!base) {
      renderEntryBlocks(container, entryFromContainer(container), { editable: false });
      return;
    }
    renderEntryBlocks(
      container,
      {
        id: container.dataset.entryId,
        version: base.version,
        blocks: base.blocks,
      },
      { editable: false },
    );
  });
}

/** @returns {Promise<boolean>} true if saved successfully */
export async function saveEntryBlocks(container, entry) {
  const writer = getCurrentWriter();
  if (!writer) return false;

  const local = gatherBlocksFromDom(container);
  let version = Number(container.dataset.version || entry.version);
  let payload = local;

  for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
    try {
      const data = await apiPut(`/entries/${entry.id}/blocks`, {
        version,
        blocks: payload,
      });
      container.dataset.version = String(data.entry.version);
      renderEntryBlocks(container, data.entry, { editable: true });
      return true;
    } catch (err) {
      if (err.status === 409 && err.data?.entry && attempt < MAX_CONFLICT_RETRIES) {
        const remoteEntry = err.data.entry;
        const base = container._editBase?.blocks ?? [];
        payload = mergeBlocks(base, local, remoteEntry.blocks || [], writer.id);
        version = Number(remoteEntry.version);
        container.dataset.version = String(version);
        continue;
      }
      alert(err.data?.error || err.message || "Save failed");
      return false;
    }
  }

  alert("Save failed: too many concurrent edits. Try again.");
  return false;
}

/**
 * Save every editable entry container under root, sequentially.
 * @returns {Promise<boolean>} true if all saves succeeded
 */
export async function saveAllEntryBlocks(root = document) {
  const containers = [...root.querySelectorAll(".entry-blocks[data-entry-id]")].filter(
    (el) => el._editBase,
  );

  for (const container of containers) {
    const entry = {
      id: container.dataset.entryId,
      version: Number(container.dataset.version || 1),
    };
    const ok = await saveEntryBlocks(container, entry);
    if (!ok) return false;
  }
  return true;
}

export function applyFormatToBlocks(root) {
  const mode = getFormatMode();
  root.querySelectorAll(".entry-block").forEach((el) => {
    el.classList.remove("simple", "stylized");
    el.classList.add(mode);
  });
  root.querySelectorAll(".session-title, .game-date-heading").forEach((el) => {
    el.classList.remove("simple", "stylized");
    el.classList.add(mode);
  });
}
