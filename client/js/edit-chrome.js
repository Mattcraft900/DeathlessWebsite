/**
 * Edit chrome for entry pages (travelogue, character).
 *
 * Mobile (<900px)
 * ---------------
 * - Tap FAB → enter edit mode (or open login first).
 * - Long-press FAB (~500ms) → account sheet (log out / change writer).
 * - In edit mode: FAB hides, full-width Save/Cancel footer shows.
 * - Scroll direction hides/shows FAB/footer; typing reveals footer.
 *
 * Desktop (≥900px)
 * ----------------
 * - FAB / mobile footer hidden.
 * - Sidebar `.edit-sidebar-btn`: Edit (pencil) ↔ Save; long-press Edit → account.
 * - Compact bottom `.edit-desktop-bar` with Save/Cancel — not scroll-hidden.
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
    isKeyboardRevealSuppressed,
    saveAllEntryBlocks,
    setAllEntriesEditable,
} from "./blocks.js";

/* ---------------------------------------------------------- */
/* -- Constants & module state                             -- */
/* ---------------------------------------------------------- */

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 12;
const DESKTOP_MQ = "(min-width: 900px)";

const EDIT_ICON_SVG = `
    <svg class="edit-sidebar-btn__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/>
    </svg>
`;

const SAVE_ICON_SVG = `
    <svg class="edit-sidebar-btn__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>
    </svg>
`;

let editMode = false;
const listeners = new Set();
let chromeRoot = null;
let fabEl = null;
let footerEl = null;
let desktopBarEl = null;
let lastScrollY = 0;
let scrollTicking = false;
let chromeHidden = false;
let headerHidden = false;
let lastViewportHeight = 0;
/** @type {ReturnType<typeof setTimeout>|null} */
let revealViewportTimer = null;
/** @type {ReturnType<typeof setTimeout>|null} */
let focusRevealTimer = null;

let pressTimer = null;
let pressStartX = 0;
let pressStartY = 0;
/** Set when long-press fires so the subsequent click is ignored. */
let suppressClick = false;
/** Element that owns the in-progress long-press (FAB or sidebar btn). */
let pressTarget = null;

let desktopMq = null;

/* ---------------------------------------------------------- */
/* -- Edit mode pub/sub                                    -- */
/* ---------------------------------------------------------- */

/** @returns {boolean} */
export function isEditMode() {
    return editMode;
}

/** @returns {boolean} */
function isDesktopEditLayout() {
    return desktopMq?.matches ?? window.matchMedia(DESKTOP_MQ).matches;
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
    syncSidebarEditButtons();
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

/** FAB / footer / desktop bar swap; reset mobile hide state. */
function syncChromeVisibility() {
    if (!fabEl || !footerEl || !desktopBarEl) return;

    const desktop = isDesktopEditLayout();

    fabEl.hidden = editMode || desktop;
    footerEl.hidden = !editMode || desktop;
    desktopBarEl.hidden = !editMode || !desktop;

    fabEl.setAttribute("aria-hidden", fabEl.hidden ? "true" : "false");
    footerEl.setAttribute("aria-hidden", footerEl.hidden ? "true" : "false");
    desktopBarEl.setAttribute(
        "aria-hidden",
        desktopBarEl.hidden ? "true" : "false",
    );

    showHeader();
    chromeHidden = true;
    setChromeHidden(false);
}

/** Slide FAB/footer off-screen while scrolling down (mobile only). */
function setChromeHidden(hidden) {
    if (isDesktopEditLayout()) {
        chromeHidden = false;
        fabEl?.classList.remove("edit-chrome-hidden");
        footerEl?.classList.remove("edit-chrome-hidden");
        return;
    }
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

const REVEAL_MARGIN_PX = 12;
const REVEAL_SETTLE_MS = 180;

/**
 * Smoothly nudge the page so `el` sits fully inside the visual viewport
 * (minimal delta). Useful when the soft keyboard covers a focused block.
 * No-op on desktop edit layout. Safe to call from future mid-page reveals;
 * do not use for Jump To / back-to-top (those stay instant).
 * No-op when `el` is already fully visible in the visual viewport.
 *
 * @param {HTMLElement} el
 */
export function smoothRevealInVisualViewport(el) {
    if (!(el instanceof HTMLElement) || !el.isConnected) return;
    if (isDesktopEditLayout()) return;

    const vp = window.visualViewport;
    const vpTop = vp?.offsetTop ?? 0;
    const vpHeight = vp?.height ?? window.innerHeight;
    const vpBottom = vpTop + vpHeight;

    let footerClip = 0;
    if (footerEl && !footerEl.hidden && !footerEl.classList.contains("edit-chrome-hidden")) {
        const fr = footerEl.getBoundingClientRect();
        if (fr.height > 0 && fr.top < vpBottom && fr.bottom > vpTop) {
            footerClip = Math.max(0, vpBottom - fr.top);
        }
    }

    const rect = el.getBoundingClientRect();
    const limitBottom = vpBottom - footerClip - REVEAL_MARGIN_PX;
    const limitTop = vpTop + REVEAL_MARGIN_PX;

    // Already fully visible — don't scroll (avoids fighting insert/focus races).
    if (rect.top >= limitTop && rect.bottom <= limitBottom) return;

    let delta = 0;
    if (rect.bottom > limitBottom) {
        delta = rect.bottom - limitBottom;
    } else if (rect.top < limitTop) {
        delta = rect.top - limitTop;
    }

    if (Math.abs(delta) < 1) return;
    window.scrollBy({ top: delta, behavior: "smooth" });
}

/** If an editable entry block is focused and covered, reveal it above the keyboard. */
function ensureFocusedBlockVisibleAboveKeyboard() {
    if (!editMode || isDesktopEditLayout()) return;
    if (isKeyboardRevealSuppressed()) return;
    const el = document.activeElement;
    if (!isEntryEditTarget(el)) return;
    smoothRevealInVisualViewport(el);
}

function scheduleFocusedBlockReveal(delayMs = REVEAL_SETTLE_MS) {
    if (isKeyboardRevealSuppressed()) return;
    if (revealViewportTimer != null) {
        clearTimeout(revealViewportTimer);
        revealViewportTimer = null;
    }
    revealViewportTimer = setTimeout(() => {
        revealViewportTimer = null;
        ensureFocusedBlockVisibleAboveKeyboard();
    }, delayMs);
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
    if (editMode || isDesktopEditLayout()) return;
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (!t.closest(".entry-blocks, .game-date-entry, .session-block, #character-description")) {
        return;
    }
    setChromeHidden(false);
}

function onEditFocusIn(e) {
    if (!editMode || isDesktopEditLayout()) return;
    if (!isEntryEditTarget(e.target)) return;
    if (isKeyboardRevealSuppressed()) return;
    if (focusRevealTimer != null) clearTimeout(focusRevealTimer);
    focusRevealTimer = setTimeout(() => {
        focusRevealTimer = null;
        ensureFocusedBlockVisibleAboveKeyboard();
    }, REVEAL_SETTLE_MS);
}

function onEditFocusOut() {
    if (!editMode) return;
    requestAnimationFrame(() => {
        if (!isEntryEditTarget(document.activeElement)) {
            showHeader();
        }
    });
}

function onViewportResize() {
    const vp = window.visualViewport;
    const height = vp?.height ?? window.innerHeight;
    if (height > lastViewportHeight + 40) {
        showHeader();
    } else if (height < lastViewportHeight - 40) {
        // Keyboard opening (or viewport shrinking) — keep focused block visible.
        scheduleFocusedBlockReveal();
    }
    lastViewportHeight = height;
}

function onScroll() {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
        showHeader();

        if (isDesktopEditLayout()) {
            lastScrollY = window.scrollY || document.documentElement.scrollTop;
            scrollTicking = false;
            return;
        }

        const y = window.scrollY || document.documentElement.scrollTop;
        const delta = y - lastScrollY;

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
/* -- FAB / sidebar gestures (tap vs long-press)           -- */
/* ---------------------------------------------------------- */

function clearPressTimer() {
    if (pressTimer != null) {
        clearTimeout(pressTimer);
        pressTimer = null;
    }
    pressTarget = null;
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
 * Long-press → account modal.
 * Change writer / logout discards any in-progress edit first.
 */
async function handleAccountLongPress() {
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

function onPressPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const target = e.currentTarget;
    if (!(target instanceof HTMLElement)) return;

    // Sidebar Save mode: no long-press account
    if (target.classList.contains("edit-sidebar-btn") && editMode) return;

    clearPressTimer();
    suppressClick = false;
    pressTarget = target;
    pressStartX = e.clientX;
    pressStartY = e.clientY;

    pressTimer = setTimeout(() => {
        pressTimer = null;
        suppressClick = true;
        pressTarget = null;
        handleAccountLongPress();
    }, LONG_PRESS_MS);
}

function onPressPointerMove(e) {
    if (pressTimer == null) return;
    const dx = e.clientX - pressStartX;
    const dy = e.clientY - pressStartY;
    if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) {
        clearPressTimer();
    }
}

function onPressPointerEnd() {
    clearPressTimer();
}

function wirePressGestures(el) {
    el.addEventListener("pointerdown", onPressPointerDown);
    el.addEventListener("pointermove", onPressPointerMove);
    el.addEventListener("pointerup", onPressPointerEnd);
    el.addEventListener("pointercancel", onPressPointerEnd);
    el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
    });
}

/* ---------------------------------------------------------- */
/* -- Sidebar Edit / Save buttons                          -- */
/* ---------------------------------------------------------- */

function syncSidebarEditButtons() {
    document.querySelectorAll(".edit-sidebar-btn").forEach((btn) => {
        if (!(btn instanceof HTMLElement)) return;
        if (editMode) {
            btn.innerHTML = `${SAVE_ICON_SVG}<span class="edit-sidebar-btn__label">Save</span>`;
            btn.setAttribute("aria-label", "Save");
            btn.title = "Save changes";
            btn.classList.add("is-save");
        } else {
            btn.innerHTML = `${EDIT_ICON_SVG}<span class="edit-sidebar-btn__label">Edit</span>`;
            btn.setAttribute("aria-label", "Edit");
            btn.title = "Edit · Hold for account";
            btn.classList.remove("is-save");
        }
        btn.disabled = false;
    });
}

async function handleSidebarEditClick(e) {
    const btn = e.target.closest?.(".edit-sidebar-btn");
    if (!(btn instanceof HTMLElement)) return;

    if (suppressClick) {
        e.preventDefault();
        e.stopPropagation();
        suppressClick = false;
        return;
    }

    if (editMode) {
        btn.disabled = true;
        try {
            await handleSave();
        } finally {
            syncSidebarEditButtons();
        }
        return;
    }

    await handleEditClick(e);
}

/**
 * Ensure sidebar Edit buttons are wired (idempotent). Call after DOM rebuilds
 * that inject new `.edit-sidebar-btn` nodes (e.g. character re-render).
 */
export function refreshSidebarEditButtons() {
    document.querySelectorAll(".edit-sidebar-btn").forEach((btn) => {
        if (!(btn instanceof HTMLElement)) return;
        if (btn.dataset.editWired === "1") return;
        btn.dataset.editWired = "1";
        wirePressGestures(btn);
        btn.addEventListener("click", handleSidebarEditClick);
    });
    syncSidebarEditButtons();
}

/* ---------------------------------------------------------- */
/* -- Save / Cancel                                        -- */
/* ---------------------------------------------------------- */

async function handleSave() {
    if (!editMode) return;
    const saveBtns = [
        footerEl?.querySelector(".edit-footer-save"),
        desktopBarEl?.querySelector(".edit-desktop-bar-save"),
        ...document.querySelectorAll(".edit-sidebar-btn.is-save"),
    ].filter(Boolean);

    for (const b of saveBtns) b.disabled = true;
    try {
        const ok = await saveAllEntryBlocks(document);
        if (ok) exitEditMode({ discard: false });
    } finally {
        for (const b of saveBtns) b.disabled = false;
        syncSidebarEditButtons();
    }
}

async function handleCancel() {
    if (!editMode) return;
    const discard = await showDiscardConfirmModal();
    if (discard) exitEditMode({ discard: true });
}

/* ---------------------------------------------------------- */
/* -- Build & init                                         -- */
/* ---------------------------------------------------------- */

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
    wirePressGestures(fabEl);
    fabEl.addEventListener("click", handleEditClick);

    footerEl = document.createElement("div");
    footerEl.className = "edit-footer";
    footerEl.hidden = true;
    footerEl.innerHTML = `
        <button type="button" class="edit-footer-btn edit-footer-save">Save</button>
        <button type="button" class="edit-footer-btn edit-footer-cancel">Cancel</button>
    `;
    footerEl.querySelector(".edit-footer-save").addEventListener("click", handleSave);
    footerEl.querySelector(".edit-footer-cancel").addEventListener("click", handleCancel);

    desktopBarEl = document.createElement("div");
    desktopBarEl.className = "edit-desktop-bar";
    desktopBarEl.hidden = true;
    desktopBarEl.setAttribute("role", "toolbar");
    desktopBarEl.setAttribute("aria-label", "Edit actions");
    desktopBarEl.innerHTML = `
        <button type="button" class="edit-desktop-bar-btn edit-desktop-bar-save">Save</button>
        <button type="button" class="edit-desktop-bar-btn edit-desktop-bar-cancel">Cancel</button>
    `;
    desktopBarEl
        .querySelector(".edit-desktop-bar-save")
        .addEventListener("click", handleSave);
    desktopBarEl
        .querySelector(".edit-desktop-bar-cancel")
        .addEventListener("click", handleCancel);

    chromeRoot.append(fabEl, footerEl, desktopBarEl);
    document.body.appendChild(chromeRoot);
    syncChromeVisibility();
}

/**
 * Mount floating Edit FAB / Save-Cancel footer / desktop bar on entry pages.
 * Idempotent if `#edit-chrome` already exists.
 */
export function initEditChrome() {
    if (document.getElementById("edit-chrome")) {
        refreshSidebarEditButtons();
        return;
    }

    desktopMq = window.matchMedia(DESKTOP_MQ);
    desktopMq.addEventListener("change", () => {
        syncChromeVisibility();
    });

    buildChrome();
    refreshSidebarEditButtons();

    lastScrollY = window.scrollY || document.documentElement.scrollTop;
    lastViewportHeight = window.visualViewport?.height ?? window.innerHeight;

    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("beforeinput", onEditTyping, true);
    document.addEventListener("input", onEditTyping, true);
    document.addEventListener("pointerdown", onEntryTap, true);
    document.addEventListener("focusin", onEditFocusIn, true);
    document.addEventListener("focusout", onEditFocusOut, true);

    const vp = window.visualViewport;
    if (vp) {
        vp.addEventListener("resize", onViewportResize);
    } else {
        window.addEventListener("resize", onViewportResize);
    }
}
