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
    container.onclick = (e) => {
      if (e.target !== container) return;
      insertOwnBlockAtEnd(container, writer);
    };

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "save-blocks-btn edit-only";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => saveEntryBlocks(container, entry));
    container.appendChild(saveBtn);
  } else {
    container.onclick = null;
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
 * Clicks on the edge of an own editable often hit-test onto the neighboring
 * foreign span; caretRangeFromPoint then snaps to the *far* end of that span.
 * Snap offset to the near edge when the pointer is hugging a sibling block.
 */
function resolveClickOffset(foreignSpan, clientX, clientY) {
  const text = foreignSpan.textContent ?? "";
  let offset = text.length;

  if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(clientX, clientY);
    if (range && foreignSpan.contains(range.startContainer)) {
      if (range.startContainer.nodeType === Node.TEXT_NODE) {
        offset = range.startOffset;
      }
    }
  } else if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(clientX, clientY);
    if (pos && foreignSpan.contains(pos.offsetNode) && pos.offsetNode.nodeType === Node.TEXT_NODE) {
      offset = pos.offset;
    }
  }

  offset = Math.max(0, Math.min(offset, text.length));

  const prev = blockSibling(foreignSpan, "prev");
  const next = blockSibling(foreignSpan, "next");
  const prevDist = prev ? distanceToRect(clientX, clientY, prev.getBoundingClientRect()) : Infinity;
  const nextDist = next ? distanceToRect(clientX, clientY, next.getBoundingClientRect()) : Infinity;
  const edgeSlop = 8;

  if (nextDist <= edgeSlop && nextDist <= prevDist) offset = text.length;
  else if (prevDist <= edgeSlop) offset = 0;

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
  const formatMode = getFormatMode();
  const last = container.querySelector(".entry-block:last-of-type");
  const span = document.createElement("span");
  span.className = `entry-block ${writer.cssClass} ${formatMode}`;
  span.dataset.writerId = writer.id;
  span.dataset.sortRank = generateKeyBetween(last?.dataset.sortRank ?? null, null);
  span.contentEditable = "true";
  span.textContent = "";
  wireOwnEditable(span);
  const saveBtn = container.querySelector(".save-blocks-btn");
  if (saveBtn) {
    container.insertBefore(span, saveBtn);
  } else {
    container.appendChild(span);
  }
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

export async function saveEntryBlocks(container, entry, retried = false) {
  const writer = getCurrentWriter();
  if (!writer) return;

  const version = Number(container.dataset.version || entry.version);
  const gathered = gatherBlocksFromDom(container);

  try {
    const data = await apiPut(`/entries/${entry.id}/blocks`, {
      version,
      blocks: gathered,
    });
    container.dataset.version = String(data.entry.version);
    renderEntryBlocks(container, data.entry, { editable: true });
  } catch (err) {
    if (err.status === 409 && !retried && err.data?.entry) {
      container.dataset.version = String(err.data.entry.version);
      renderEntryBlocks(container, err.data.entry, { editable: true });
      return saveEntryBlocks(container, err.data.entry, true);
    }
    alert(err.data?.error || err.message || "Save failed");
  }
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
