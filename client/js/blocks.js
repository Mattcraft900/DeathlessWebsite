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

    if (!canEdit && editable && writer) {
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

function insertOwnBlockAfter(afterSpan, writer) {
  const formatMode = getFormatMode();
  const next = afterSpan.nextElementSibling?.classList?.contains("entry-block")
    ? afterSpan.nextElementSibling
    : null;
  const span = document.createElement("span");
  span.className = `entry-block ${writer.cssClass} ${formatMode}`;
  span.dataset.writerId = writer.id;
  span.dataset.sortRank = generateKeyBetween(
    afterSpan.dataset.sortRank ?? null,
    next?.dataset.sortRank ?? null,
  );
  span.contentEditable = "true";
  span.textContent = "";
  afterSpan.after(span);
  span.focus();
}

/** Split a foreign block at the click point and insert an empty own-voice block between. */
function insertCommentaryAtPoint(foreignSpan, writer, clientX, clientY) {
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
  const formatMode = getFormatMode();
  const before = text.slice(0, offset);
  const after = text.slice(offset);
  const next = foreignSpan.nextElementSibling?.classList?.contains("entry-block")
    ? foreignSpan.nextElementSibling
    : null;
  const baseRank = foreignSpan.dataset.sortRank ?? null;
  const afterRank = next?.dataset.sortRank ?? null;

  if (!before.trim() && !after.trim()) {
    insertOwnBlockAfter(foreignSpan, writer);
    return;
  }

  if (!before.trim()) {
    // Insert before this block
    const span = document.createElement("span");
    span.className = `entry-block ${writer.cssClass} ${formatMode}`;
    span.dataset.writerId = writer.id;
    span.dataset.sortRank = generateKeyBetween(null, baseRank);
    // Need rank before foreign — use generateKeyBetween(prev, foreign)
    const prev = foreignSpan.previousElementSibling?.classList?.contains("entry-block")
      ? foreignSpan.previousElementSibling
      : null;
    span.dataset.sortRank = generateKeyBetween(prev?.dataset.sortRank ?? null, baseRank);
    span.contentEditable = "true";
    span.textContent = "";
    foreignSpan.before(span);
    span.focus();
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

  const own = document.createElement("span");
  own.className = `entry-block ${writer.cssClass} ${formatMode}`;
  own.dataset.writerId = writer.id;
  own.dataset.sortRank = midRank;
  own.contentEditable = "true";
  own.textContent = "";

  const continuation = document.createElement("span");
  continuation.className = foreignSpan.className;
  continuation.dataset.writerId = foreignSpan.dataset.writerId;
  continuation.dataset.sortRank = afterOwnRank;
  continuation.contentEditable = "false";
  continuation.textContent = after;
  continuation.title = "Click where you want to insert your commentary";
  continuation.addEventListener("click", (e) => {
    e.stopPropagation();
    insertCommentaryAtPoint(continuation, writer, e.clientX, e.clientY);
  });

  foreignSpan.after(own, continuation);
  own.focus();
}
function insertOwnBlockAtEnd(container, writer) {
  const formatMode = getFormatMode();
  const span = document.createElement("span");
  span.className = `entry-block ${writer.cssClass} ${formatMode}`;
  span.dataset.writerId = writer.id;
  span.dataset.sortRank = generateKeyBetween(
    container.querySelector(".entry-block:last-of-type")?.dataset.sortRank ?? null,
    null,
  );
  span.contentEditable = "true";
  span.textContent = "";
  const saveBtn = container.querySelector(".save-blocks-btn");
  if (saveBtn) {
    container.insertBefore(span, saveBtn);
  } else {
    container.appendChild(span);
  }
  span.focus();
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
