/**
 * Mobile edit scroll policy: hold page scroll across DOM mutations, then
 * reveal the focused block if the soft keyboard (or footer) covers it.
 *
 * Jump To / back-to-top stay instant and do not use this module.
 */

const REVEAL_SETTLE_MS = 180;

/** @type {number} */
let scrollHoldDepth = 0;
/** @type {number} */
let scrollHoldY = 0;
/** @type {ReturnType<typeof setTimeout>|null} */
let revealTimer = null;
/** @type {(() => void)|null} */
let revealHandler = null;

/**
 * Register the chrome-side reveal implementation (edit mode + visualViewport).
 * @param {(() => void)|null} fn
 */
export function setKeyboardRevealHandler(fn) {
    revealHandler = fn;
}

/** @returns {boolean} */
export function isScrollHeld() {
    return scrollHoldDepth > 0;
}

export function cancelPendingReveal() {
    if (revealTimer != null) {
        clearTimeout(revealTimer);
        revealTimer = null;
    }
}

/**
 * After focus settles, nudge the focused block into the visual viewport if covered.
 * No-ops while a scroll hold is active (hold schedules reveal when it ends).
 * @param {number} [delayMs]
 */
export function requestRevealIfCovered(delayMs = REVEAL_SETTLE_MS) {
    if (scrollHoldDepth > 0) return;
    cancelPendingReveal();
    revealTimer = setTimeout(() => {
        revealTimer = null;
        if (scrollHoldDepth > 0) return;
        revealHandler?.();
    }, delayMs);
}

/**
 * Snapshot scrollY, run DOM/focus work, restore instantly, then schedule one reveal.
 * Re-entrant: nested calls share one snapshot and one post-hold reveal.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function holdScrollDuring(fn) {
    const outer = scrollHoldDepth === 0;
    if (outer) {
        scrollHoldY = window.scrollY;
        cancelPendingReveal();
    }
    scrollHoldDepth += 1;
    try {
        return fn();
    } finally {
        scrollHoldDepth -= 1;
        if (scrollHoldDepth === 0) {
            window.scrollTo({ top: scrollHoldY, behavior: "instant" });
            requestRevealIfCovered();
        }
    }
}
