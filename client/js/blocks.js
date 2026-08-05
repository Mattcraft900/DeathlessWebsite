/**
 * Multi-voice entry editor (travelogue chunks + character bios).
 *
 * Mental model
 * ------------
 * An entry is an ordered list of *voice blocks* (spans). Each block belongs to
 * one writer, has trimmed `body` text in the DB, a fractional `sortRank`, and a
 * `startsParagraph` flag. Visual paragraphs are NOT separate DOM containers —
 * they are rebuilt client-side between blocks:
 *   - next block has startsParagraph → insert `.entry-para-break`
 *   - otherwise → insert a single space text node
 * So "paragraph" is a run of blocks until the next startsParagraph flag.
 *
 * Editing modes (when `editable` + logged-in writer):
 *   - Own voice (or admin on any voice) → contentEditable; Enter handled here
 *   - Foreign voice → click/tap inserts your empty commentary block at that point
 *   - Clicks on container padding / gutters / para gaps → nearest sensible edge
 *
 * Save contract:
 *   - `_editBase` snapshots blocks+version when edit mode starts (merge base)
 *   - Local DOM → gatherBlocksFromDom (trim bodies, fold unsaved same-voice runs)
 *   - PUT with expected `version`; on 409, 3-way merge(base, local, remote) and retry
 *
 * Mid-paragraph Enter is allowed for everyone (honor system). Boundary Enter still
 * only flips startsParagraph flags so writers can promote an inline aside to its
 * own paragraph without splitting text.
 */

import { generateKeyBetween } from "fractional-indexing";
import { apiPut } from "./api.js";
import { getCurrentWriter } from "./auth-ui.js";
import { holdScrollDuring } from "./edit-scroll.js";
import { applyHandwritingStyle } from "./fonts.js";

/* ---------------------------------------------------------- */
/* -- Format mode                                          -- */
/* ---------------------------------------------------------- */

/** @returns {"simple"|"stylized"} current formatting dropdown value (default stylized) */
function getFormatMode() {
    const dropdown =
        document.getElementById("format-dropdown") ||
        document.getElementById("format-dropdown-inline");
    return dropdown?.value === "simple" ? "simple" : "stylized";
}

/* ---------------------------------------------------------- */
/* -- Mobile insert gesture guards                         -- */
/* ---------------------------------------------------------- */

/** @type {number} */
let ghostClickSuppressedUntil = 0;
let ghostClickShieldWired = false;

/**
 * Block the browser's delayed click after pointerup+scroll so it can't hit
 * format controls / Jump To that slid under the finger (ghost click).
 * @param {number} [ms=400]
 */
function armGhostClickSuppression(ms = 400) {
    ghostClickSuppressedUntil = performance.now() + ms;
    if (ghostClickShieldWired) return;
    ghostClickShieldWired = true;
    const block = (e) => {
        if (performance.now() >= ghostClickSuppressedUntil) return;
        e.preventDefault();
        e.stopImmediatePropagation();
    };
    document.addEventListener("click", block, true);
    document.addEventListener("auxclick", block, true);
}

/* ---------------------------------------------------------- */
/* -- Render entry blocks                                  -- */
/* ---------------------------------------------------------- */

/**
 * Wipe and rebuild an entry's block DOM from an entry payload.
 * When editable and a writer is logged in, also wires edit handlers and stores
 * `_editBase` for later discard / 3-way merge on conflict.
 *
 * @param {HTMLElement} container target `.entry-blocks` element
 * @param {{ id: string, version?: number, blocks?: object[] }} entry
 * @param {{ editable?: boolean }} [options]
 */
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
        setStartsParagraph(span, Boolean(block.startsParagraph));
        setVoiceName(span, block.writerDisplayName);
        span.textContent = block.body;
        applyHandwritingStyle(
            span,
            block.writerHandwritingColor,
            block.writerHandwritingFont,
        );

        // Admin can edit any voice; everyone else only their own writerId.
        const canEdit =
            editable && writer && (writer.isAdmin || writer.id === block.writerId);
        span.contentEditable = canEdit ? "true" : "false";

        if (canEdit) {
            wireOwnEditable(span);
        } else if (editable && writer) {
            // Foreign block: tap inserts commentary at the tapped offset.
            wireForeignCommentary(span, writer);
        }

        container.appendChild(span);
    }

    refreshBlockSeparators(container);

    if (editable && writer) {
        // Snapshot at edit-enter time: merge base for concurrent saves + discard.
        container._editBase = {
            version: entry.version,
            blocks: (entry.blocks || []).map((b) => ({
                id: b.id,
                writerId: b.writerId,
                body: b.body,
                startsParagraph: Boolean(b.startsParagraph),
                sortRank: b.sortRank,
                writerCssClass: b.writerCssClass,
                writerDisplayName: b.writerDisplayName,
                writerHandwritingColor: b.writerHandwritingColor,
                writerHandwritingFont: b.writerHandwritingFont,
            })),
        };

        // Mobile Chrome often fires the delayed "click" on the *container* after a
        // tap that started on a block (focus/layout retarget). Without this guard,
        // we'd treat that as a padding click and jump the caret elsewhere.
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
            e.preventDefault();
            handleContainerClick(container, writer, e.clientX, e.clientY);
        };
    } else {
        container.onclick = null;
        container.onpointerdown = null;
        delete container._editBase;
    }
}

/* ---------------------------------------------------------- */
/* -- Paragraph flags & separators                         -- */
/* ---------------------------------------------------------- */

/** @param {Element|null|undefined} el */
function isEntryBlock(el) {
    return el instanceof HTMLElement && el.classList.contains("entry-block");
}

/** @param {HTMLElement|null|undefined} el */
function readStartsParagraph(el) {
    return el?.dataset?.startsParagraph === "true";
}

/**
 * Persist startsParagraph on the element (omit attribute when false so the DOM
 * stays clean and serialize reads stay boolean-safe).
 * @param {HTMLElement} el
 * @param {boolean} value
 */
function setStartsParagraph(el, value) {
    if (value) el.dataset.startsParagraph = "true";
    else delete el.dataset.startsParagraph;
}

/**
 * Stamp uppercase Simple-mode label name on a block (`data-voice-name`).
 * Used by CSS ::before; not part of textContent / saves.
 * @param {HTMLElement} span
 * @param {string|null|undefined} displayName
 */
function setVoiceName(span, displayName) {
    const name = (displayName ?? "").trim();
    if (name) span.dataset.voiceName = name.toUpperCase();
    else delete span.dataset.voiceName;
}

/** @returns {HTMLSpanElement} paragraph-gap marker between voice blocks */
function createParaBreak() {
    const el = document.createElement("span");
    el.className = "entry-para-break";
    el.setAttribute("aria-hidden", "true");
    return el;
}

/**
 * Mark open/close of contiguous non-Lucy voice runs for angle-bracket chrome
 * (stylized `<…>` and Simple `<NAME: …>`). CSS-only; not in textContent / saves.
 * @param {HTMLElement[]} blocks
 */
function refreshVoiceRunMarkers(blocks) {
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        block.classList.remove("voice-run-open", "voice-run-close");
        if (block.classList.contains("voice-lucy")) continue;
        const prev = blocks[i - 1];
        const next = blocks[i + 1];
        if (!prev || prev.dataset.writerId !== block.dataset.writerId) {
            block.classList.add("voice-run-open");
        }
        if (!next || next.dataset.writerId !== block.dataset.writerId) {
            block.classList.add("voice-run-close");
        }
    }
}

/**
 * Rebuild space / paragraph separators between entry-block children.
 *
 * Bodies in the DB are edge-trimmed. Display spacing is entirely client-side:
 * strip all non-block children, then re-insert either a space or a para-break
 * before each block after the first. Call this after any insert/remove/split
 * that changes block order or startsParagraph flags.
 *
 * Skip the separator space when a neighbor already has edge whitespace so
 * mid-split inserts next to an existing space don't show a double gap.
 *
 * @param {HTMLElement|null|undefined} container
 */
function refreshBlockSeparators(container) {
    if (!container) return;
    const active = document.activeElement;
    const restoreFocus =
        active instanceof HTMLElement &&
        container.contains(active) &&
        isEntryBlock(active)
            ? active
            : null;
    const restoreOffset = restoreFocus ? getCaretOffsetInBlock(restoreFocus) : 0;

    const blocks = [...container.children].filter(isEntryBlock);
    while (container.firstChild) container.removeChild(container.firstChild);
    for (let i = 0; i < blocks.length; i++) {
        if (i > 0) {
            if (readStartsParagraph(blocks[i])) {
                container.appendChild(createParaBreak());
            } else if (
                !blockHasEdgeWhitespace(blocks[i - 1], "end") &&
                !blockHasEdgeWhitespace(blocks[i], "start")
            ) {
                container.appendChild(document.createTextNode(" "));
            }
        }
        container.appendChild(blocks[i]);
    }
    refreshVoiceRunMarkers(blocks);

    if (restoreFocus?.isConnected) {
        restoreFocus.focus({ preventScroll: true });
        placeCaretAtOffset(restoreFocus, restoreOffset);
    }
}

/**
 * Whether a block's visible text (ZWSP ignored) already has whitespace on an edge.
 * @param {HTMLElement} el
 * @param {"start"|"end"} side
 */
function blockHasEdgeWhitespace(el, side) {
    const t = stripZwsp(el.textContent ?? "");
    if (!t) return false;
    return side === "end" ? /\s$/.test(t) : /^\s/.test(t);
}

/**
 * Walk previous/next element siblings until the next `.entry-block`
 * (skips spaces and `.entry-para-break`).
 * @param {HTMLElement} span
 * @param {"prev"|"next"} direction
 * @returns {HTMLElement|null}
 */
function blockSibling(span, direction) {
    let el = direction === "prev" ? span.previousElementSibling : span.nextElementSibling;
    while (el && !isEntryBlock(el)) {
        el = direction === "prev" ? el.previousElementSibling : el.nextElementSibling;
    }
    return isEntryBlock(el) ? el : null;
}

/** @param {HTMLElement} container @returns {HTMLElement[]} */
function entryBlocksInOrder(container) {
    return [...container.children].filter(isEntryBlock);
}

/**
 * Where this block sits inside its visual paragraph (run until next startsParagraph).
 * Used by Enter handling to decide "insert empty para above" vs "split mid-text".
 *
 * @param {HTMLElement} span
 * @returns {"only"|"first"|"last"|"middle"}
 */
function paragraphRole(span) {
    const container = span.parentElement;
    if (!container) return "only";
    const blocks = entryBlocksInOrder(container);
    const idx = blocks.indexOf(span);
    if (idx < 0) return "only";

    let start = idx;
    while (start > 0 && !readStartsParagraph(blocks[start])) start -= 1;

    let end = idx;
    while (end + 1 < blocks.length && !readStartsParagraph(blocks[end + 1])) end += 1;

    if (start === end) return "only";
    if (idx === start) return "first";
    if (idx === end) return "last";
    return "middle";
}

/* ---------------------------------------------------------- */
/* -- Own-block helpers (empty / continuation)             -- */
/* ---------------------------------------------------------- */

/** @param {Element} el @param {{ id: string }} writer */
function isOwnEditableBlock(el, writer) {
    return isEntryBlock(el) && el.isContentEditable && el.dataset.writerId === writer.id;
}

/** Zero-width space: keeps caret between CSS <> brackets on empty non-Lucy inserts. */
const ZWSP = "\u200B";

/** @param {string|null|undefined} text */
function stripZwsp(text) {
    return (text ?? "").replaceAll(ZWSP, "");
}

/** @param {HTMLElement} el */
function isNonLucyBlock(el) {
    return isEntryBlock(el) && !el.classList.contains("voice-lucy");
}

/** @param {HTMLElement} el */
function isBlank(el) {
    return !stripZwsp(el.textContent ?? "").trim();
}

/**
 * Keep a ZWSP text node in empty non-Lucy editable blocks so the caret sits
 * between ::before `<` and ::after `>`. Strip ZWSP once real text exists.
 * @param {HTMLElement} span
 * @returns {boolean} true if textContent was changed
 */
function ensureNonLucyPlaceholder(span) {
    if (!span.isContentEditable || !isNonLucyBlock(span)) return false;
    const raw = span.textContent ?? "";
    if (isBlank(span)) {
        if (raw !== ZWSP) {
            span.textContent = ZWSP;
            return true;
        }
        return false;
    }
    const cleaned = stripZwsp(raw);
    if (cleaned !== raw) {
        span.textContent = cleaned;
        return true;
    }
    return false;
}

/** Toggle `data-empty` for CSS placeholders on blank editable blocks. */
function syncEmptyAttr(el) {
    if (isBlank(el)) el.dataset.empty = "true";
    else delete el.dataset.empty;
}

/**
 * Unsaved foreign "second half" created by a mid-split commentary insert.
 * Marked so blur-discard can rejoin it if the user never typed in the middle.
 */
function isUnsavedContinuation(el, writerId) {
    return (
        isEntryBlock(el) &&
        !el.isContentEditable &&
        el.dataset.writerId === writerId &&
        !el.dataset.blockId &&
        el.dataset.splitContinuation === "1"
    );
}

/**
 * On blur of an empty own block: remove it.
 * Special case — mid-split that was abandoned: [foreign before][empty own][continuation]
 * → glue foreign halves back together and drop the empty insert.
 *
 * Do NOT rejoin ordinary neighbors when deleting a normal middle empty block —
 * concatenating foreign text onto another writer's persisted id would rewrite
 * their body on Save and get a 403 from the server.
 *
 * @param {HTMLElement} span
 */
function discardIfEmpty(span) {
    if (!span.isConnected || span.dataset.discarded === "1" || !isBlank(span)) {
        if (span.isConnected && span.dataset.discarded !== "1") syncEmptyAttr(span);
        return;
    }

    holdScrollDuring(() => {
        const container = span.parentElement;
        const prev = blockSibling(span, "prev");
        const next = blockSibling(span, "next");
        span.dataset.discarded = "1";
        if (
            prev &&
            next &&
            prev.dataset.writerId &&
            isUnsavedContinuation(next, prev.dataset.writerId)
        ) {
            const left = prev.textContent ?? "";
            const right = next.textContent ?? "";
            const leftVis = stripZwsp(left);
            const rightVis = stripZwsp(right);
            const needSpace =
                leftVis.length > 0 &&
                rightVis.length > 0 &&
                !/\s$/.test(leftVis) &&
                !/^\s/.test(rightVis);
            prev.textContent = needSpace ? `${left} ${right}` : `${left}${right}`;
            next.remove();
            span.remove();
            refreshBlockSeparators(container);
            return;
        }

        const wasFirst = !prev;
        span.remove();
        // If we removed the first block of the entry, the new first shouldn't keep
        // a stale "starts paragraph" from being the old second block's flag alone —
        // first block of the whole entry is never a "break after previous".
        if (wasFirst && next) {
            setStartsParagraph(next, false);
        }
        refreshBlockSeparators(container);
    });
}

/**
 * Drop other blank own-voice inserts in this entry before creating a new one,
 * so blur-timeout discard doesn't rebuild the DOM under a pending tap.
 * @param {HTMLElement|null|undefined} container
 * @param {object} writer
 * @param {HTMLElement|null} [exceptEl] keep this empty (e.g. reusing it)
 */
function discardOtherEmptyOwnBlocks(container, writer, exceptEl = null) {
    if (!container || !writer) return;
    const empties = entryBlocksInOrder(container).filter(
        (el) => el !== exceptEl && isOwnEditableBlock(el, writer) && isBlank(el),
    );
    for (const el of empties) {
        discardIfEmpty(el);
    }
}

/* ---------------------------------------------------------- */
/* -- Enter / paragraph splits                             -- */
/* ---------------------------------------------------------- */

/**
 * Character offset of the caret inside a block's text content.
 * @param {HTMLElement} span
 * @returns {number}
 */
function getCaretOffsetInBlock(span) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return 0;
    const range = selection.getRangeAt(0);
    if (!span.contains(range.startContainer)) return 0;

    const pre = range.cloneRange();
    pre.selectNodeContents(span);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
}

/**
 * Custom Enter for editable blocks (preventDefault — no browser <br>/divs).
 *
 * Decision tree:
 * 1. Caret at end + next block is inline → mark next startsParagraph (promote aside)
 * 2. Caret at start + this block is inline → mark this startsParagraph
 * 3. First-in-paragraph + caret at 0 → insert empty own paragraph *above*
 * 4. Otherwise → split text at caret; new block starts a paragraph
 *
 * Voice preservation: when admin splits a Nemah block, the new half stays Nemah
 * (same writerId / voice class), not Lucy. Handler runs for any contentEditable
 * block while a session writer exists — including admin editing foreign voices —
 * so we never fall through to native Enter that would vanish on save.
 *
 * @param {HTMLElement} span
 * @param {object} writer current session writer (may be admin)
 * @param {KeyboardEvent} e
 */
function handleEnterInOwnBlock(span, writer, e) {
    e.preventDefault();

    const role = paragraphRole(span);
    const text = span.textContent ?? "";
    const offset = getCaretOffsetInBlock(span);
    const atStart = offset === 0;
    const atEnd = offset >= text.length;
    const container = span.parentElement;
    const prev = blockSibling(span, "prev");
    const next = blockSibling(span, "next");

    // Boundary: Enter at end → following block starts a paragraph.
    // Example: Lucy at end of her text before an inline Nemah that should be its own para.
    if (atEnd && next && !readStartsParagraph(next)) {
        setStartsParagraph(next, true);
        refreshBlockSeparators(container);
        return;
    }

    // Boundary: Enter at start → this block starts a paragraph.
    if (atStart && prev && !readStartsParagraph(span)) {
        setStartsParagraph(span, true);
        refreshBlockSeparators(container);
        return;
    }

    // First-in-paragraph at caret 0: insert an empty own paragraph above
    // (rather than splitting this block into before/after with after keeping the rest).
    if (role === "first" && atStart) {
        const formatMode = getFormatMode();
        const empty = document.createElement("span");
        empty.className = `entry-block ${writer.cssClass} ${formatMode}`;
        empty.dataset.writerId = writer.id;
        empty.dataset.sortRank = generateKeyBetween(
            prev?.dataset.sortRank ?? null,
            span.dataset.sortRank ?? null,
        );
        empty.contentEditable = "true";
        empty.textContent = "";
        setVoiceName(empty, writer.displayName);
        applyHandwritingStyle(empty, writer.handwritingColor, writer.handwritingFont);
        setStartsParagraph(empty, readStartsParagraph(span));
        setStartsParagraph(span, true);
        wireOwnEditable(empty);
        span.before(empty);
        refreshBlockSeparators(container);
        focusBlockCaret(empty, false);
        return;
    }

    // Mid-text (or only-block) split: before stays here; after becomes a new paragraph.
    // Keep the edited block's voice (admin splitting Nemah stays Nemah).
    const before = text.slice(0, offset);
    const after = text.slice(offset);
    span.textContent = before;
    syncEmptyAttr(span);

    const formatMode = getFormatMode();
    const voiceClass = voiceClassFromEl(span) || writer.cssClass;
    const voiceWriterId = span.dataset.writerId || writer.id;
    const neu = document.createElement("span");
    neu.className = `entry-block ${voiceClass} ${formatMode}`;
    neu.dataset.writerId = voiceWriterId;
    neu.dataset.sortRank = generateKeyBetween(
        span.dataset.sortRank ?? null,
        next?.dataset.sortRank ?? null,
    );
    neu.contentEditable = "true";
    neu.textContent = after;
    setVoiceName(neu, span.dataset.voiceName || writer.displayName);
    neu.style.setProperty("--writer-color", span.style.getPropertyValue("--writer-color"));
    neu.style.setProperty("--writer-font", span.style.getPropertyValue("--writer-font"));
    if (!neu.style.getPropertyValue("--writer-color")) neu.style.removeProperty("--writer-color");
    if (!neu.style.getPropertyValue("--writer-font")) neu.style.removeProperty("--writer-font");
    setStartsParagraph(neu, true);
    wireOwnEditable(neu);
    span.after(neu);
    refreshBlockSeparators(container);
    focusBlockCaret(neu, false);
}

/**
 * Wire input / Enter / blur / edge-pointer behavior for an editable block.
 * @param {HTMLElement} span
 */
function wireOwnEditable(span) {
    ensureNonLucyPlaceholder(span);
    syncEmptyAttr(span);
    span.addEventListener("input", () => {
        const changed = ensureNonLucyPlaceholder(span);
        if (changed) {
            focusBlockCaret(span, !isBlank(span));
        }
        syncEmptyAttr(span);
    });
    span.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
        const writer = getCurrentWriter();
        // Session writer may be admin editing another voice — still handle Enter.
        if (!writer) return;
        handleEnterInOwnBlock(span, writer, e);
    });
    // Empty remainder of the last line before a paragraph break often hits the
    // editable span itself (especially admin/Lucy). Treat that as "caret at end"
    // instead of letting the browser put the caret at the start of the next para.
    // On mobile, always preventDefault so the browser doesn't scroll-into-view;
    // we place the caret ourselves with preventScroll (same as inserts).
    span.addEventListener("pointerdown", (e) => {
        if (e.button != null && e.button !== 0) return;

        const next = blockSibling(span, "next");
        const last = next && readStartsParagraph(next) ? blockEdgeAnchors(span).end.rect : null;
        const tapPastLastLineEnd =
            last &&
            e.clientY >= last.top - 2 &&
            e.clientY <= last.bottom + 2 &&
            e.clientX > last.right;

        const mobile = window.matchMedia("(max-width: 899px)").matches;
        if (!mobile) {
            if (!tapPastLastLineEnd) return;
            e.preventDefault();
            focusBlockCaret(span, true);
            return;
        }

        e.preventDefault();
        if (tapPastLastLineEnd) {
            focusBlockCaret(span, true);
            return;
        }

        const text = span.textContent ?? "";
        const offset = Math.max(
            0,
            Math.min(offsetFromPointInSpan(span, e.clientX, e.clientY), text.length),
        );
        span.focus({ preventScroll: true });
        const place = () => placeCaretAtOffset(span, offset);
        place();
        requestAnimationFrame(place);
    });
    span.addEventListener("blur", () => {
        setTimeout(() => {
            if (!span.isConnected || span.dataset.discarded === "1") return;
            discardIfEmpty(span);
        }, 0);
    });
}

/**
 * Foreign (read-only) voice block: tap inserts commentary.
 * pointerdown preventDefault keeps the soft keyboard up by avoiding a blur of
 * the currently focused empty insert before we move focus ourselves.
 * @param {HTMLElement} span
 * @param {object} writer
 */
function wireForeignCommentary(span, writer) {
    span.tabIndex = -1;
    span.title = "Click where you want to insert your commentary";
    /** @type {number|null} */
    let activePointer = null;
    span.addEventListener("pointerdown", (e) => {
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        activePointer = e.pointerId;
    });
    span.addEventListener("pointercancel", (e) => {
        if (e.pointerId === activePointer) activePointer = null;
    });
    span.addEventListener("pointerup", (e) => {
        if (activePointer !== e.pointerId) return;
        activePointer = null;
        e.stopPropagation();
        armGhostClickSuppression();
        insertCommentaryAtPoint(span, writer, e.clientX, e.clientY);
    });
    // Swallow click so container padding handler doesn't also fire after pointerup.
    span.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
    });
}

/* ---------------------------------------------------------- */
/* -- Geometry / caret placement                           -- */
/* ---------------------------------------------------------- */

/** Euclidean distance from a point to the nearest edge of a rect (0 if inside). */
function distanceToRect(x, y, rect) {
    const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    return Math.hypot(dx, dy);
}

/**
 * Focus a block and place the caret at start or end of its text.
 * Re-applies after rAF because some browsers reset caret to 0 on focus.
 * Uses preventScroll so mobile rebuilds / off-screen empties don't jump the viewport.
 *
 * @param {HTMLElement} span
 * @param {boolean} atEnd
 */
function focusBlockCaret(span, atEnd) {
    span.focus({ preventScroll: true });
    const place = () => {
        const textNode = [...span.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
        const len = textNode?.textContent?.length ?? 0;
        placeCaretAtOffset(span, atEnd ? len : 0);
    };
    place();
    // Some browsers reset the caret to offset 0 on focus; re-apply after that.
    requestAnimationFrame(place);
}

/**
 * Place the caret at a character offset within a block (clamped).
 * @param {HTMLElement} span
 * @param {number} offset
 */
function placeCaretAtOffset(span, offset) {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    const textNode = [...span.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
    if (textNode) {
        const len = textNode.textContent?.length ?? 0;
        const o = Math.max(0, Math.min(offset, len));
        range.setStart(textNode, o);
        range.collapse(true);
    } else {
        range.selectNodeContents(span);
        range.collapse(true);
    }
    selection.removeAllRanges();
    selection.addRange(range);
}

/**
 * Nearest character offset in a span for a client point.
 * Binary-searches range rects — used when caretRangeFromPoint is missing or
 * unreliable (notably mobile Chrome, which used to default wrongly to end).
 *
 * @param {HTMLElement} span
 * @param {number} clientX
 * @param {number} clientY
 * @returns {number}
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
 * Resolve where in a foreign block a click/tap landed for commentary insert.
 * Uses geometry (not caretRangeFromPoint). Sibling-edge snap only applies in
 * the *gutter* (closer to a neighbor than to this block) — never while the tap
 * is inside this span's box. That avoids "click near border → wrong end of entry".
 *
 * @param {HTMLElement} foreignSpan
 * @param {number} clientX
 * @param {number} clientY
 * @returns {number} character offset
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

/**
 * Snap a commentary insert offset to a word boundary so existing words are
 * never split. If already at an edge or next to whitespace, keep as-is;
 * otherwise move to the nearer whitespace (or string edge). Ties prefer right.
 *
 * @param {string} text
 * @param {number} offset
 * @returns {number}
 */
function snapOffsetToWordBoundary(text, offset) {
    const len = text.length;
    let o = Math.max(0, Math.min(offset, len));
    if (o <= 0 || o >= len) return o;

    const left = text[o - 1];
    const right = text[o];
    if (/\s/.test(left) || /\s/.test(right)) return o;

    let leftBound = o;
    while (leftBound > 0 && !/\s/.test(text[leftBound - 1])) leftBound -= 1;

    let rightBound = o;
    while (rightBound < len && !/\s/.test(text[rightBound])) rightBound += 1;

    if (o - leftBound <= rightBound - o) return leftBound;
    return rightBound;
}

/* ---------------------------------------------------------- */
/* -- Insert own / commentary blocks                       -- */
/* ---------------------------------------------------------- */

/**
 * Insert an empty own-voice block after `afterSpan`, or focus an existing one.
 * @param {HTMLElement} afterSpan
 * @param {object} writer
 */
function insertOwnBlockAfter(afterSpan, writer) {
    holdScrollDuring(() => {
        const container = afterSpan.parentElement;
        const next = blockSibling(afterSpan, "next");
        if (isOwnEditableBlock(next, writer)) {
            discardOtherEmptyOwnBlocks(container, writer, next);
            focusBlockCaret(next, false);
            return;
        }

        discardOtherEmptyOwnBlocks(container, writer);

        const formatMode = getFormatMode();
        const span = document.createElement("span");
        span.className = `entry-block ${writer.cssClass} ${formatMode}`;
        span.dataset.writerId = writer.id;
        span.dataset.sortRank = generateKeyBetween(
            afterSpan.dataset.sortRank ?? null,
            blockSibling(afterSpan, "next")?.dataset.sortRank ?? null,
        );
        span.contentEditable = "true";
        span.textContent = "";
        setVoiceName(span, writer.displayName);
        applyHandwritingStyle(span, writer.handwritingColor, writer.handwritingFont);
        setStartsParagraph(span, false);
        wireOwnEditable(span);
        afterSpan.after(span);
        refreshBlockSeparators(afterSpan.parentElement);
        focusBlockCaret(span, false);
    });
}

/**
 * Insert an empty own-voice block before `beforeSpan`, or focus an existing one.
 * @param {HTMLElement} beforeSpan
 * @param {object} writer
 */
function insertOwnBlockBefore(beforeSpan, writer) {
    holdScrollDuring(() => {
        const container = beforeSpan.parentElement;
        const prev = blockSibling(beforeSpan, "prev");
        if (isOwnEditableBlock(prev, writer)) {
            discardOtherEmptyOwnBlocks(container, writer, prev);
            focusBlockCaret(prev, true);
            return;
        }

        discardOtherEmptyOwnBlocks(container, writer);

        const formatMode = getFormatMode();
        const span = document.createElement("span");
        span.className = `entry-block ${writer.cssClass} ${formatMode}`;
        span.dataset.writerId = writer.id;
        span.dataset.sortRank = generateKeyBetween(
            blockSibling(beforeSpan, "prev")?.dataset.sortRank ?? null,
            beforeSpan.dataset.sortRank ?? null,
        );
        span.contentEditable = "true";
        span.textContent = "";
        setVoiceName(span, writer.displayName);
        applyHandwritingStyle(span, writer.handwritingColor, writer.handwritingFont);
        setStartsParagraph(span, false);
        wireOwnEditable(span);
        beforeSpan.before(span);
        refreshBlockSeparators(beforeSpan.parentElement);
        focusBlockCaret(span, false);
    });
}

/**
 * Split a foreign block at the click point and insert an empty own-voice block
 * between the halves. Edge clicks next to an existing own block reuse that block
 * instead of stacking empties. Mid-split marks the after-half as an unsaved
 * continuation so blur can undo an abandoned insert.
 *
 * @param {HTMLElement} foreignSpan
 * @param {object} writer
 * @param {number} clientX
 * @param {number} clientY
 */
function insertCommentaryAtPoint(foreignSpan, writer, clientX, clientY) {
    holdScrollDuring(() => {
        const container = foreignSpan.parentElement;
        discardOtherEmptyOwnBlocks(container, writer);

        // Sync discard may rejoin a mid-split and remove a continuation under the tap.
        let target = foreignSpan;
        if (!target.isConnected && container) {
            target =
                entryBlocksInOrder(container).find((b) => {
                    const r = b.getBoundingClientRect();
                    return (
                        clientX >= r.left &&
                        clientX <= r.right &&
                        clientY >= r.top &&
                        clientY <= r.bottom
                    );
                }) ?? null;
            if (!target) return;
            if (isOwnEditableBlock(target, writer)) {
                focusBlockCaret(target, false);
                return;
            }
        }

        const text = target.textContent ?? "";
        let offset = resolveClickOffset(target, clientX, clientY);
        offset = snapOffsetToWordBoundary(text, offset);
        const before = text.slice(0, offset);
        const after = text.slice(offset);
        const next = blockSibling(target, "next");
        const baseRank = target.dataset.sortRank ?? null;
        const afterRank = next?.dataset.sortRank ?? null;

        // Edge click next to an existing own block → edit that block, don't insert again.
        if (!before.trim()) {
            const prev = blockSibling(target, "prev");
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
            insertOwnBlockAfter(target, writer);
            return;
        }

        if (!before.trim()) {
            insertOwnBlockBefore(target, writer);
            return;
        }

        if (!after.trim()) {
            insertOwnBlockAfter(target, writer);
            return;
        }

        // Mid-split: keep before in original, insert own, then after as new foreign continuation.
        // Edge-trim halves so live spacing matches the saved (edge-trimmed) body contract.
        target.textContent = before.trimEnd();
        const midRank = generateKeyBetween(baseRank, afterRank);
        const afterOwnRank = generateKeyBetween(midRank, afterRank);
        const formatMode = getFormatMode();

        const own = document.createElement("span");
        own.className = `entry-block ${writer.cssClass} ${formatMode}`;
        own.dataset.writerId = writer.id;
        own.dataset.sortRank = midRank;
        own.contentEditable = "true";
        own.textContent = "";
        setVoiceName(own, writer.displayName);
        applyHandwritingStyle(own, writer.handwritingColor, writer.handwritingFont);
        setStartsParagraph(own, false);
        wireOwnEditable(own);

        const continuation = document.createElement("span");
        continuation.className = target.className;
        continuation.dataset.writerId = target.dataset.writerId;
        continuation.dataset.sortRank = afterOwnRank;
        continuation.dataset.splitContinuation = "1";
        continuation.contentEditable = "false";
        continuation.textContent = after.trimStart();
        setVoiceName(continuation, target.dataset.voiceName);
        continuation.style.setProperty(
            "--writer-color",
            target.style.getPropertyValue("--writer-color"),
        );
        continuation.style.setProperty(
            "--writer-font",
            target.style.getPropertyValue("--writer-font"),
        );
        if (!continuation.style.getPropertyValue("--writer-color")) {
            continuation.style.removeProperty("--writer-color");
        }
        if (!continuation.style.getPropertyValue("--writer-font")) {
            continuation.style.removeProperty("--writer-font");
        }
        setStartsParagraph(continuation, false);
        wireForeignCommentary(continuation, writer);

        target.after(own, continuation);
        refreshBlockSeparators(container);
        focusBlockCaret(own, false);
    });
}

/* ---------------------------------------------------------- */
/* -- Container / gutter / paragraph-gap clicks            -- */
/* ---------------------------------------------------------- */

/**
 * On-screen start/end anchors for a block: left-center of the first line
 * fragment and right-center of the last (not the fat union bounding box).
 * For a one-line block these are opposite ends of the same line box.
 * Using real glyph-line edges (getClientRects) avoids AABB "nearest border"
 * bugs that sent the caret to the wrong block or the end of the entry.
 *
 * @param {HTMLElement} span
 */
function blockEdgeAnchors(span) {
    const rects = span.getClientRects();
    if (!rects.length) {
        const r = span.getBoundingClientRect();
        return {
            start: { x: r.left, y: (r.top + r.bottom) / 2, rect: r },
            end: { x: r.right, y: (r.top + r.bottom) / 2, rect: r },
            bottom: r.bottom,
        };
    }
    const first = rects[0];
    const last = rects[rects.length - 1];
    return {
        start: { x: first.left, y: (first.top + first.bottom) / 2, rect: first },
        end: { x: last.right, y: (last.top + last.bottom) / 2, rect: last },
        bottom: last.bottom,
    };
}

function distanceToPoint(x, y, p) {
    return Math.hypot(x - p.x, y - p.y);
}

/** True if clientY overlaps a rect's vertical span (with slop). */
function yOverlapsRect(clientY, rect, slop = 14) {
    return clientY >= rect.top - slop && clientY <= rect.bottom + slop;
}

/** True if (x,y) lies inside any of the element's glyph line boxes. */
function pointInGlyphBoxes(el, x, y) {
    for (const r of el.getClientRects()) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
    return false;
}

/**
 * Place caret / insert at the end of a block (paragraph-above helper).
 * @param {HTMLElement} above
 * @param {object} writer
 */
function placeAtBlockEnd(above, writer) {
    if (above.isContentEditable) {
        holdScrollDuring(() => {
            discardOtherEmptyOwnBlocks(above.parentElement, writer, above);
            focusBlockCaret(above, true);
        });
        return;
    }
    const next = blockSibling(above, "next");
    if (isOwnEditableBlock(next, writer)) {
        holdScrollDuring(() => {
            discardOtherEmptyOwnBlocks(above.parentElement, writer, next);
            focusBlockCaret(next, false);
        });
        return;
    }
    insertOwnBlockAfter(above, writer);
}

/**
 * If the click is in a paragraph gap (or last-line remainder above a break),
 * return the last block of the paragraph above; otherwise null.
 * Does not match same-paragraph inter-block spaces (those use edge candidates).
 *
 * Ideal UX: clicking the empty space between paragraphs (including the empty
 * rest of the last line above the break) puts the caret at the end of the
 * paragraph above — not at some distant "nearest border".
 *
 * @param {HTMLElement[]} blocks
 * @param {number} clientX
 * @param {number} clientY
 * @returns {HTMLElement|null}
 */
function resolveParaGapAbove(blocks, clientX, clientY) {
    for (let i = 1; i < blocks.length; i++) {
        if (!readStartsParagraph(blocks[i])) continue;
        const above = blocks[i - 1];
        const below = blocks[i];
        const aboveLast = blockEdgeAnchors(above).end.rect;
        const belowFirst = blockEdgeAnchors(below).start.rect;
        const bandTop = aboveLast.bottom - 4;
        const bandBottom = belowFirst.top + 4;
        const inGapBand = clientY >= bandTop && clientY <= bandBottom;
        const inLastLineRemainder =
            clientY >= aboveLast.top - 2 &&
            clientY <= aboveLast.bottom + 4 &&
            clientX > aboveLast.right - 1;
        const outsideGlyphs =
            !pointInGlyphBoxes(above, clientX, clientY) &&
            !pointInGlyphBoxes(below, clientX, clientY);
        const betweenParas =
            outsideGlyphs && clientY >= bandTop && clientY <= bandBottom;
        if (inGapBand || inLastLineRemainder || betweenParas) return above;
    }
    return null;
}

/**
 * Clicks on inter-block spaces / para gaps hit the container (not a span).
 * Prefer the nearest real text edge (focus or commentary insert) instead of
 * always jumping to the end of the entry. Only true trailing padding below the
 * last block appends at end.
 *
 * Candidate edges are filtered by Y-overlap with start/end line boxes so a
 * click between two mid-paragraph blocks doesn't pick a far-away border.
 *
 * @param {HTMLElement} container
 * @param {object} writer
 * @param {number} clientX
 * @param {number} clientY
 */
function handleContainerClick(container, writer, clientX, clientY) {
    const blocks = entryBlocksInOrder(container);
    if (!blocks.length) {
        insertOwnBlockAtEnd(container, writer);
        return;
    }

    const lastEdges = blockEdgeAnchors(blocks[blocks.length - 1]);
    if (clientY > lastEdges.bottom + 4) {
        insertOwnBlockAtEnd(container, writer);
        return;
    }

    const paraAbove = resolveParaGapAbove(blocks, clientX, clientY);
    if (paraAbove) {
        placeAtBlockEnd(paraAbove, writer);
        return;
    }

    const candidates = [];
    for (const block of blocks) {
        const { start, end } = blockEdgeAnchors(block);
        if (yOverlapsRect(clientY, start.rect)) {
            candidates.push({ block, atEnd: false, dist: distanceToPoint(clientX, clientY, start) });
        }
        if (yOverlapsRect(clientY, end.rect)) {
            candidates.push({ block, atEnd: true, dist: distanceToPoint(clientX, clientY, end) });
        }
    }

    // No Y-overlapping edges: if we're below some block that ends a paragraph,
    // land at that paragraph end — never scan every edge in the entry (that was
    // the "caret jumps to entry end" failure mode).
    if (!candidates.length) {
        for (let i = blocks.length - 1; i >= 0; i--) {
            if (blockEdgeAnchors(blocks[i]).bottom > clientY + 4) continue;
            const next = blocks[i + 1];
            if (next && readStartsParagraph(next)) {
                placeAtBlockEnd(blocks[i], writer);
            }
            return;
        }
        return;
    }

    let best = null;
    for (const c of candidates) {
        if (!best || c.dist < best.dist) best = c;
    }
    if (!best) return;

    if (best.block.isContentEditable) {
        holdScrollDuring(() => {
            discardOtherEmptyOwnBlocks(container, writer, best.block);
            focusBlockCaret(best.block, best.atEnd);
        });
        return;
    }

    // Foreign edge: same as insertCommentaryAtPoint at offset 0 / end.
    if (best.atEnd) {
        const next = blockSibling(best.block, "next");
        if (isOwnEditableBlock(next, writer)) {
            holdScrollDuring(() => {
                discardOtherEmptyOwnBlocks(container, writer, next);
                focusBlockCaret(next, false);
            });
            return;
        }
        insertOwnBlockAfter(best.block, writer);
        return;
    }

    const prev = blockSibling(best.block, "prev");
    if (isOwnEditableBlock(prev, writer)) {
        holdScrollDuring(() => {
            discardOtherEmptyOwnBlocks(container, writer, prev);
            focusBlockCaret(prev, true);
        });
        return;
    }
    insertOwnBlockBefore(best.block, writer);
}

/**
 * Append an empty own block at the end of the entry (or focus existing last own).
 * @param {HTMLElement} container
 * @param {object} writer
 */
function insertOwnBlockAtEnd(container, writer) {
    holdScrollDuring(() => {
        const blocks = entryBlocksInOrder(container);
        const last = blocks[blocks.length - 1] ?? null;
        if (isOwnEditableBlock(last, writer)) {
            discardOtherEmptyOwnBlocks(container, writer, last);
            focusBlockCaret(last, true);
            return;
        }

        discardOtherEmptyOwnBlocks(container, writer);

        const formatMode = getFormatMode();
        const span = document.createElement("span");
        span.className = `entry-block ${writer.cssClass} ${formatMode}`;
        span.dataset.writerId = writer.id;
        span.dataset.sortRank = generateKeyBetween(last?.dataset.sortRank ?? null, null);
        span.contentEditable = "true";
        span.textContent = "";
        setVoiceName(span, writer.displayName);
        applyHandwritingStyle(span, writer.handwritingColor, writer.handwritingFont);
        setStartsParagraph(span, blocks.length > 0);
        wireOwnEditable(span);
        container.appendChild(span);
        refreshBlockSeparators(container);
        focusBlockCaret(span, false);
    });
}

/* ---------------------------------------------------------- */
/* -- Gather / serialize for save                          -- */
/* ---------------------------------------------------------- */

/**
 * Read blocks from the live DOM for PUT payload.
 * Trims bodies (DB stores edge-trimmed text; separators are client-only).
 * Skips empty unsaved blocks. Folds adjacent brand-new same-voice runs.
 *
 * @param {HTMLElement} container
 * @returns {object[]}
 */
function gatherBlocksFromDom(container) {
    const writer = getCurrentWriter();
    if (!writer) return [];

    const blocks = [];
    let prevRank = null;

    for (const node of container.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            // Inter-block space separators — ignore
            continue;
        }

        if (!(node instanceof HTMLElement) || !node.classList.contains("entry-block")) {
            continue;
        }

        const body = stripZwsp(node.textContent ?? "").trim();
        if (!body && !node.dataset.blockId) continue;

        const sortRank =
            node.dataset.sortRank || generateKeyBetween(prevRank, null);
        blocks.push({
            id: node.dataset.blockId || undefined,
            writerId: node.dataset.writerId,
            body,
            startsParagraph: readStartsParagraph(node),
            sortRank,
        });
        prevRank = sortRank;
    }

    return mergeAdjacentSameWriter(blocks);
}

/**
 * Fold only brand-new (no id) adjacent runs of the same voice, and never across
 * a paragraph boundary. Persisted blocks stay separate so concurrent edits to
 * different halves don't get smashed together incorrectly.
 *
 * @param {object[]} blocks
 * @returns {object[]}
 */
function mergeAdjacentSameWriter(blocks) {
    const merged = [];
    for (const block of blocks) {
        const prev = merged[merged.length - 1];
        // Only fold brand-new adjacent runs of the same voice (no persisted ids yet),
        // and never across a paragraph boundary.
        if (
            prev &&
            prev.writerId === block.writerId &&
            !prev.id &&
            !block.id &&
            !block.startsParagraph
        ) {
            prev.body = `${prev.body}${block.body}`.trim();
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
        startsParagraph: Boolean(b.startsParagraph),
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

/** Assign fresh fractional ranks in list order (after merge rearranges). */
function rerankBlocks(blocks) {
    let prev = null;
    return blocks.map((b) => {
        const sortRank = generateKeyBetween(prev, null);
        prev = sortRank;
        return { ...b, sortRank };
    });
}

/* ---------------------------------------------------------- */
/* -- 3-way merge & save                                   -- */
/* ---------------------------------------------------------- */

/**
 * True if `nextBody` looks like a prefix or suffix shorten of `baseBody`
 * (typical mid-split commentary: foreign block kept only the before or after half).
 */
function isForeignShorten(baseBody, nextBody) {
    if (baseBody === nextBody) return false;
    if (baseBody.startsWith(nextBody) && nextBody.length < baseBody.length) return true;
    if (baseBody.endsWith(nextBody) && nextBody.length < baseBody.length) return true;
    return false;
}

/** Text that was cut off when shortening a foreign block. */
function foreignRemainder(baseBody, keptBody) {
    if (baseBody.startsWith(keptBody) && keptBody.length < baseBody.length) {
        return baseBody.slice(keptBody.length);
    }
    if (baseBody.endsWith(keptBody) && keptBody.length < baseBody.length) {
        return baseBody.slice(0, baseBody.length - keptBody.length);
    }
    return "";
}

/**
 * True if the split remainder already exists after the shortened prefix on remote
 * (another writer already completed the same split — don't duplicate the half).
 */
function hasContinuationAfter(result, afterId, remainder, foreignWriterId) {
    if (!remainder) return false;
    const trimmed = remainder.trim();
    const idx = result.findIndex((r) => r.id === afterId);
    if (idx < 0) return false;
    for (let j = idx + 1; j < result.length; j++) {
        const b = result[j];
        if (b.writerId === foreignWriterId && b.body.trim() === trimmed) return true;
    }
    return false;
}

/**
 * 3-way merge for concurrent saves: start from remote, overlay this writer's
 * deletions / updates / splits / inserts from local relative to base.
 *
 * Steps (high level):
 * 1. Clone remote as result
 * 2. Drop ids this writer deleted locally (present in base, absent in local)
 * 3. Apply this writer's body/flag updates on own blocks; admin may update
 *    foreign bodies too; anyone may flip foreign startsParagraph when body
 *    is unchanged (layout-only promote)
 * 4. Apply compatible foreign shortens if remote still has the untouched base body
 * 5. Insert no-id runs from local, anchored after/before surviving ids; skip
 *    re-inserting a foreign continuation if remote already split the same place
 * 6. Rerank + fold adjacent unsaved same-voice runs
 *
 * @param {object[]} base blocks when this edit session started
 * @param {object[]} local blocks gathered from DOM now
 * @param {object[]} remote blocks from the 409 response
 * @param {string} writerId
 * @returns {object[]} merged payload for retry
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
            target.startsParagraph = Boolean(b.startsParagraph);
        } else if (isAdmin) {
            const baseBlock = baseById.get(b.id);
            if (baseBlock && b.body !== baseBlock.body) {
                target.body = b.body;
            }
            if (baseBlock && Boolean(b.startsParagraph) !== Boolean(baseBlock.startsParagraph)) {
                target.startsParagraph = Boolean(b.startsParagraph);
            }
        } else {
            // Layout-only: promote/demote paragraph break on a foreign block
            // without changing its text (Enter at end of own voice before it).
            const baseBlock = baseById.get(b.id);
            if (
                baseBlock &&
                b.body === baseBlock.body &&
                Boolean(b.startsParagraph) !== Boolean(baseBlock.startsParagraph)
            ) {
                target.startsParagraph = Boolean(b.startsParagraph);
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

/** @param {HTMLElement} el @returns {string} first `voice-*` class or "" */
function voiceClassFromEl(el) {
    for (const cls of el.classList) {
        if (cls.startsWith("voice-")) return cls;
    }
    return "";
}

/**
 * Read per-writer handwriting vars from inline styles (set by applyHandwritingStyle).
 * Font is stored as `"Family Name", Helvetica, sans-serif`.
 * @param {HTMLElement} el
 * @returns {{ writerHandwritingColor?: string, writerHandwritingFont?: string }}
 */
function handwritingFromEl(el) {
    const color = el.style.getPropertyValue("--writer-color").trim();
    const rawFont = el.style.getPropertyValue("--writer-font").trim();
    let font = "";
    if (rawFont) {
        const quoted = rawFont.match(/^"([^"]+)"/);
        font = quoted ? quoted[1] : (rawFont.split(",")[0] || "").trim();
    }
    return {
        writerHandwritingColor: color || undefined,
        writerHandwritingFont: font || undefined,
    };
}

/**
 * Snapshot entry blocks from the DOM for re-render (includes voice CSS class).
 * Unlike gatherBlocksFromDom, keeps raw textContent (no trim) so mode toggles
 * don't reshape whitespace mid-edit.
 *
 * @param {HTMLElement} container
 * @returns {object[]}
 */
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
            startsParagraph: readStartsParagraph(node),
            sortRank: node.dataset.sortRank,
            writerCssClass: voiceClassFromEl(node),
            writerDisplayName: node.dataset.voiceName || undefined,
            ...handwritingFromEl(node),
        });
    }
    return blocks;
}

/** @param {HTMLElement} container */
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
 *
 * @param {ParentNode} [root=document]
 * @param {boolean} [editable=false]
 */
export function setAllEntriesEditable(root = document, editable = false) {
    root.querySelectorAll(".entry-blocks[data-entry-id]").forEach((container) => {
        renderEntryBlocks(container, entryFromContainer(container), { editable });
    });
}

/**
 * Restore each editable container from its `_editBase` snapshot (read-only).
 * @param {ParentNode} [root=document]
 */
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

/**
 * Save one entry's blocks with optimistic concurrency.
 * On 409 Conflict, merges local changes onto the remote entry and retries
 * (up to MAX_CONFLICT_RETRIES).
 *
 * @param {HTMLElement} container
 * @param {{ id: string, version?: number }} entry
 * @returns {Promise<boolean>} true if saved successfully
 */
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
 * Save every editable entry container under root, sequentially (one PUT each).
 * There is no atomic multi-entry batch API — if a later entry fails, earlier
 * ones may already have saved (partial success). Returns false on first failure.
 *
 * @param {ParentNode} [root=document]
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

/**
 * Apply stylized/simple classes from the format dropdown to blocks + headings.
 * @param {ParentNode} root
 */
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
