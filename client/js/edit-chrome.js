/**
 * Floating Edit FAB + Save/Cancel footer for entry pages (travelogue, character).
 *
 * Mental model
 * ------------
 * - Tap FAB → enter edit mode (or open login first).
 * - Long-press FAB (~500ms) → account sheet (log out / change writer). Moving
 *   the pointer cancels the long-press; suppressClick prevents the follow-up tap
 *   from also entering edit mode.
 * - In edit mode: FAB hides, footer shows. Header hide is driven by *typing*
 *   (`beforeinput`/`input`), not mere focus — focus+hide used to race with
 *   insert-at-point and falsely land caret at entry end. Leaving the block /
 *   scrolling / keyboard closing (visualViewport grows) restores the header.
 * - Scroll direction hides/shows the FAB/footer chrome (same pattern as many
 *   mobile apps); near top of page always shows chrome.
 */

import {
    getCurrentWriter,
    logoutWriter,
    promptLogin,
    showAccountModal,
    showDiscardConfirmModal,
} from "./auth-ui.js";
import {
    discardAllEntryBlocks,
    saveAllEntryBlocks,
    setAllEntriesEditable,
} from "./blocks.js";

/* ---------------------------------------------------------- */
/* -- Constants & module state                             -- */
/* ---------------------------------------------------------- */

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 12;

let editMode = false;
const listeners = new Set();
let chromeRoot = null;
let fabEl = null;
let footerEl = null;
let lastScrollY = 0;
let scrollTicking = false;
let chromeHidden = false;
let headerHidden = false;
let lastViewportHeight = 0;

let pressTimer = null;
let pressStartX = 0;
let pressStartY = 0;
/** Set when long-press fires so the subsequent click is ignored. */
let suppressClick = false;

/* ---------------------------------------------------------- */
/* -- Edit mode pub/sub                                    -- */
/* ---------------------------------------------------------- */

/** @returns {boolean} */
export function isEditMode() {
    return editMode;
}

/**
 * Subscribe to edit-mode changes.
 * @param {(editMode: boolean) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onEditModeChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function notifyEditModeChange() {
    document.body.classList.toggle("edit-mode", editMode);
    for (const fn of listeners) fn(editMode);
    syncChromeVisibility();
}

function enterEditMode() {
    if (editMode) return;
    editMode = true;
    setAllEntriesEditable(document, true);
    notifyEditModeChange();
}

/**
 * Leave edit mode.
 * @param {{ discard?: boolean }} [options] if discard, restore `_editBase` snapshots
 */
function exitEditMode({ discard = false } = {}) {
    if (!editMode) return;
    if (discard) {
        discardAllEntryBlocks(document);
    } else {
        setAllEntriesEditable(document, false);
    }
    editMode = false;
    notifyEditModeChange();
}

/* ---------------------------------------------------------- */
/* -- Chrome / header visibility                           -- */
/* ---------------------------------------------------------- */

/** FAB vs footer swap when entering/leaving edit mode; reset hide state. */
function syncChromeVisibility() {
    if (!fabEl || !footerEl) return;
    fabEl.hidden = editMode;
    footerEl.hidden = !editMode;
    fabEl.setAttribute("aria-hidden", editMode ? "true" : "false");
    footerEl.setAttribute("aria-hidden", editMode ? "false" : "true");
    showHeader();
    chromeHidden = true;
    setChromeHidden(false);
}

/** Slide FAB/footer off-screen while scrolling down. */
function setChromeHidden(hidden) {
    if (chromeHidden === hidden) return;
    chromeHidden = hidden;
    fabEl?.classList.toggle("edit-chrome-hidden", hidden);
    footerEl?.classList.toggle("edit-chrome-hidden", hidden);
}

function showHeader() {
    const header = document.getElementById("site-header");
    if (!header) return;
    headerHidden = false;
    header.classList.remove("edit-header-hidden");
}

/** Hide site header while typing in edit mode (mobile keyboard space). */
function hideHeader() {
    if (!editMode) return;
    const header = document.getElementById("site-header");
    if (!header || headerHidden) return;
    headerHidden = true;
    header.classList.add("edit-header-hidden");
}

function revealEditChrome() {
    if (!editMode) return;
    setChromeHidden(false);
}

function isEntryEditTarget(el) {
    return (
        el instanceof HTMLElement &&
        el.isContentEditable &&
        el.classList.contains("entry-block")
    );
}

/** Capture-phase: typing in a block → hide header, show footer. */
function onEditTyping(e) {
    if (!editMode) return;
    if (!isEntryEditTarget(e.target)) return;
    hideHeader();
    revealEditChrome();
}

/** Outside edit mode, tapping near entries reveals the FAB if it was scrolled away. */
function onEntryTap(e) {
    if (editMode) return;
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (!t.closest(".entry-blocks, .game-date-entry, .session-block, #character-description")) {
        return;
    }
    setChromeHidden(false);
}

function onEditFocusOut() {
    if (!editMode) return;
    // Let focus settle between blocks / into the footer before restoring
    requestAnimationFrame(() => {
        if (!isEntryEditTarget(document.activeElement)) {
            showHeader();
        }
    });
}

function onViewportResize() {
    const vp = window.visualViewport;
    const height = vp?.height ?? window.innerHeight;
    // Keyboard closing expands the visual viewport
    if (height > lastViewportHeight + 40) {
        showHeader();
    }
    lastViewportHeight = height;
}

function onScroll() {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
        const y = window.scrollY || document.documentElement.scrollTop;
        const delta = y - lastScrollY;

        // Any scroll dismisses the keyboard context → bring the header back
        showHeader();

        if (y < 24) {
            setChromeHidden(false);
        } else if (delta > 8) {
            setChromeHidden(true);
        } else if (delta < -8) {
            setChromeHidden(false);
        }

        lastScrollY = y;
        scrollTicking = false;
    });
}

/* ---------------------------------------------------------- */
/* -- FAB gestures (tap vs long-press)                     -- */
/* ---------------------------------------------------------- */

function clearPressTimer() {
    if (pressTimer != null) {
        clearTimeout(pressTimer);
        pressTimer = null;
    }
}

/** Short tap: enter edit (or login first). Ignored after a long-press. */
async function handleEditClick(e) {
    if (suppressClick) {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        suppressClick = false;
        return;
    }
    if (editMode) return;

    if (getCurrentWriter()) {
        enterEditMode();
        return;
    }

    const writer = await promptLogin();
    if (writer) enterEditMode();
}

/**
 * Long-press on FAB → account modal.
 * Change writer / logout discards any in-progress edit first.
 */
async function handleAccountLongPress() {
    // FAB is hidden in edit mode; exit defensively if that ever changes.
    if (editMode) exitEditMode({ discard: true });

    const action = await showAccountModal();

    if (action === "logout") {
        if (editMode) exitEditMode({ discard: true });
        if (getCurrentWriter()) await logoutWriter();
        return;
    }

    if (action === "change") {
        if (editMode) exitEditMode({ discard: true });
        if (getCurrentWriter()) await logoutWriter();
        const writer = await promptLogin();
        if (writer) enterEditMode();
    }
}

function onFabPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;

    clearPressTimer();
    suppressClick = false;
    pressStartX = e.clientX;
    pressStartY = e.clientY;

    pressTimer = setTimeout(() => {
        pressTimer = null;
        suppressClick = true;
        handleAccountLongPress();
    }, LONG_PRESS_MS);
}

function onFabPointerMove(e) {
    if (pressTimer == null) return;
    const dx = e.clientX - pressStartX;
    const dy = e.clientY - pressStartY;
    if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) {
        clearPressTimer();
    }
}

function onFabPointerEnd() {
    clearPressTimer();
}

/* ---------------------------------------------------------- */
/* -- Save / Cancel                                        -- */
/* ---------------------------------------------------------- */

async function handleSave() {
    if (!editMode) return;
    const saveBtn = footerEl?.querySelector(".edit-footer-save");
    if (saveBtn) saveBtn.disabled = true;
    try {
        const ok = await saveAllEntryBlocks(document);
        if (ok) exitEditMode({ discard: false });
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

async function handleCancel() {
    if (!editMode) return;
    // Confirm modal: filled "Cancel" = discard; "Keep Editing" = stay
    const discard = await showDiscardConfirmModal();
    if (discard) exitEditMode({ discard: true });
}

/* ---------------------------------------------------------- */
/* -- Build & init                                         -- */
/* ---------------------------------------------------------- */

function wireFabGestures() {
    fabEl.addEventListener("pointerdown", onFabPointerDown);
    fabEl.addEventListener("pointermove", onFabPointerMove);
    fabEl.addEventListener("pointerup", onFabPointerEnd);
    fabEl.addEventListener("pointercancel", onFabPointerEnd);
    fabEl.addEventListener("click", handleEditClick);
    // Prevent OS context menu from stealing the long-press path on mobile
    fabEl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
    });
}

function buildChrome() {
    chromeRoot = document.createElement("div");
    chromeRoot.id = "edit-chrome";
    chromeRoot.className = "edit-chrome";

    fabEl = document.createElement("button");
    fabEl.type = "button";
    fabEl.className = "edit-fab";
    fabEl.setAttribute("aria-label", "Edit");
    fabEl.title = "Tap to edit · Hold for account";
    fabEl.innerHTML = `
        <svg class="edit-fab-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/>
        </svg>
    `;
    wireFabGestures();

    footerEl = document.createElement("div");
    footerEl.className = "edit-footer";
    footerEl.hidden = true;
    footerEl.innerHTML = `
        <button type="button" class="edit-footer-btn edit-footer-save">Save</button>
        <button type="button" class="edit-footer-btn edit-footer-cancel">Cancel</button>
    `;
    footerEl.querySelector(".edit-footer-save").addEventListener("click", handleSave);
    footerEl.querySelector(".edit-footer-cancel").addEventListener("click", handleCancel);

    chromeRoot.append(fabEl, footerEl);
    document.body.appendChild(chromeRoot);
    syncChromeVisibility();
}

/**
 * Mount floating Edit FAB / Save-Cancel footer on entry pages.
 * Idempotent if `#edit-chrome` already exists.
 */
export function initEditChrome() {
    if (document.getElementById("edit-chrome")) return;

    buildChrome();
    lastScrollY = window.scrollY || document.documentElement.scrollTop;
    lastViewportHeight = window.visualViewport?.height ?? window.innerHeight;

    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("beforeinput", onEditTyping, true);
    document.addEventListener("input", onEditTyping, true);
    document.addEventListener("pointerdown", onEntryTap, true);
    document.addEventListener("focusout", onEditFocusOut, true);

    const vp = window.visualViewport;
    if (vp) {
        vp.addEventListener("resize", onViewportResize);
    } else {
        window.addEventListener("resize", onViewportResize);
    }
}
