/**
 * Travelogue page: paginated sessions, infinite scroll, Jump-to TOC, format
 * controls, Lucy session/date headings, back-to-top, and deep-link hashes.
 *
 * Sessions load in pages (`limit=3`) with a cursor (`after`). Jump-to may need
 * a session that isn't loaded yet — `ensureEntryInDom` keeps appending until
 * the target id appears or there is no next page. Deep links (`#entry-…`) use
 * the same path after first paint.
 */

import { apiGet, apiPatch, apiPost } from "./api.js";
import { getCurrentWriter, initAuth, onAuthChange, showRemoveHeadingModal } from "./auth-ui.js";
import { applyFormatToBlocks, beginWritingInEntry, placeCaretAtProseStart, renderEntryBlocks, saveEntryBlocks } from "./blocks.js";
import { ensureEditMode, initEditChrome, isEditMode, onEditModeChange, setHeadingEditHandlers } from "./edit-chrome.js";

/* ---------------------------------------------------------- */
/* -- Page elements & state                                -- */
/* ---------------------------------------------------------- */

const sessionsContainer = document.getElementById("travelogue-sessions");
const loadMoreBtn = document.getElementById("load-more-btn");
const jumpToList = document.getElementById("jump-to-list");
const jumpSidebar = document.getElementById("jump-sidebar");
const jumpToggle = document.getElementById("jump-toggle");
const formatSidebar = document.getElementById("format-sidebar");

/** Wait after closing the jump menu before scrolling (CSS transition). */
const JUMP_COLLAPSE_MS = 320;

let nextCursor = null;
let loading = false;
let loadPromise = null;
let tocData = null;
let sentinelObserver = null;
let addSessionBtn = null;
let dateChip = null;
/** @type {Map<string, { kind: "session"|"date", title: string, shown: boolean }>} */
let headingBase = new Map();
let syncFloatingBackToTop = () => {};

/** @returns {"simple"|"stylized"} */
function getFormatMode() {
    const dropdown = document.getElementById("format-dropdown");
    return dropdown?.value === "simple" ? "simple" : "stylized";
}

/* ---------------------------------------------------------- */
/* -- Session / entry DOM                                  -- */
/* ---------------------------------------------------------- */

function isLucy() {
    return getCurrentWriter()?.slug === "lucy";
}

/** Heading rename/hide, Add Session, the date chip, and Write… follow Edit mode on every width. */
function lucyCanAuthor() {
    return isLucy() && isEditMode();
}

function defaultSessionTitle(now = new Date()) {
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const year = String(now.getFullYear()).slice(-2);
    return `${month}.${day}.${year}`;
}

function renderSessionHeading(session) {
    return renderHeading({
        kind: "session",
        id: session.id,
        title: session.title || "Session",
        showHeading: session.showHeading !== false,
    });
}

function renderGameDateHeading(chunk) {
    if (!chunk.showHeading || !chunk.title) return null;
    return renderHeading({
        kind: "date",
        id: chunk.id,
        title: chunk.title,
        showHeading: true,
    });
}

/**
 * @param {{ kind: "session"|"date", id: string, title: string, showHeading: boolean }} spec
 * @returns {HTMLElement|null}
 */
function renderHeading(spec) {
    const editable = lucyCanAuthor();
    if (!spec.showHeading) {
        if (spec.kind !== "session" || !editable) return null;
        return renderSessionRestore(spec.id, spec.title);
    }

    const h = document.createElement(spec.kind === "session" ? "h3" : "h4");
    h.className =
        spec.kind === "session"
            ? `session-title ${getFormatMode()}`
            : `game-date-heading voice-lucy ${getFormatMode()}`;
    h.id = `entry-${spec.id}`;
    h.textContent = spec.title || (spec.kind === "session" ? "Session" : "New date");
    h.dataset.savedTitle = h.textContent;

    if (!editable) return h;

    h.contentEditable = "true";
    h.spellcheck = true;
    h.dataset.headingWired = "1";
    wireHeadingEditor(h);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "log-heading-remove";
    remove.setAttribute(
        "aria-label",
        spec.kind === "session" ? "Remove session title" : "Remove date",
    );
    remove.textContent = "×";
    remove.addEventListener("pointerdown", (e) => {
        e.preventDefault();
    });
    remove.addEventListener("click", () => {
        void hideHeading(h, spec.kind);
    });

    const row = document.createElement("div");
    row.className = "log-heading";
    row.dataset.entryId = spec.id;
    row.dataset.kind = spec.kind;
    row.append(h, remove);
    return row;
}

function renderGameDateEntry(chunk, editable) {
    const wrap = document.createElement("article");
    wrap.className = "game-date-entry";
    wrap.dataset.entryId = chunk.id;

    const heading = renderGameDateHeading(chunk);
    if (heading) wrap.appendChild(heading);
    // Hidden or missing date headings still need a hash target. A visible h4 keeps the id.
    if (!wrap.querySelector(".game-date-heading")) {
        wrap.id = `entry-${chunk.id}`;
    }

    const blocksEl = document.createElement("div");
    renderEntryBlocks(blocksEl, chunk, { editable });
    wrap.appendChild(blocksEl);
    return wrap;
}

function renderSessionRestore(id, title) {
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "log-heading-restore";
    restore.dataset.entryId = id;
    restore.dataset.kind = "session";
    restore.dataset.title = title || "";
    restore.textContent = "Session title hidden";
    restore.addEventListener("click", () => {
        void restoreHeading(restore);
    });
    return restore;
}

function keepHiddenDateArticle(chunk, session) {
    if (chunk.showHeading || (chunk.blocks || []).length) return true;
    return !(session.gameDates || []).some(
        (other) => other.id !== chunk.id && (other.showHeading || (other.blocks || []).length),
    );
}

function renderSession(session, editable) {
    const block = document.createElement("section");
    block.className = "session-block";
    block.dataset.entryId = session.id;
    block.dataset.sortRank = session.sortRank;
    block.dataset.headingHidden = session.showHeading === false ? "1" : "0";
    block.dataset.headingTitle = session.title || "";
    const title = renderSessionHeading(session);
    if (title) block.appendChild(title);

    for (const chunk of session.gameDates || []) {
        if (!keepHiddenDateArticle(chunk, session)) continue;
        block.appendChild(renderGameDateEntry(chunk, editable));
    }

    const sessionCheck = document.getElementById("session-check");
    if (sessionCheck && !sessionCheck.checked) {
        block.querySelector(".session-title")?.classList.add("hidden");
    }

    syncSessionWriteLine(block);
    return block;
}

/* ---------------------------------------------------------- */
/* -- Pagination / infinite scroll                         -- */
/* ---------------------------------------------------------- */

function setupInfiniteScroll() {
    const sentinel = document.getElementById("scroll-sentinel");
    if (!sentinel) return;
    if (sentinelObserver) sentinelObserver.disconnect();

    sentinelObserver = new IntersectionObserver(
        (entries) => {
            if (entries.some((e) => e.isIntersecting) && nextCursor && !loading) {
                loadSessions(true);
            }
        },
        { rootMargin: "200px" },
    );
    sentinelObserver.observe(sentinel);
}

/**
 * Fetch a page of sessions. Concurrent callers await the in-flight promise
 * instead of starting a second request.
 *
 * @param {boolean} [append=false] false = replace list; true = append next page
 */
async function loadSessions(append = false) {
    if (loading) {
        await loadPromise;
        return;
    }
    loading = true;
    if (loadMoreBtn) {
        loadMoreBtn.disabled = true;
        if (append) {
            loadMoreBtn.classList.remove("hidden");
            loadMoreBtn.classList.add("is-loading");
            loadMoreBtn.textContent = "(Loading more content)";
        }
    }

    loadPromise = (async () => {
        try {
            const qs = new URLSearchParams({ limit: "3" });
            if (append && nextCursor) qs.set("after", nextCursor);

            const data = await apiGet(`/travelogue/sessions?${qs}`);
            const editable = isEditMode();

            if (!append) sessionsContainer.innerHTML = "";

            for (const session of data.sessions) {
                sessionsContainer.appendChild(renderSession(session, editable));
            }

            nextCursor = data.nextCursor;
            if (loadMoreBtn) {
                loadMoreBtn.classList.remove("is-loading");
                loadMoreBtn.textContent = "Load more sessions";
                loadMoreBtn.classList.toggle("hidden", !nextCursor);
                loadMoreBtn.disabled = false;
            }
            updateActiveJumpLink();
        } catch (err) {
            console.error(err);
            if (!append) {
                sessionsContainer.innerHTML = `<p>Could not load travelogue.</p>`;
            }
            if (loadMoreBtn) {
                loadMoreBtn.classList.remove("is-loading");
                loadMoreBtn.textContent = "Load more sessions";
                loadMoreBtn.disabled = false;
            }
        } finally {
            loading = false;
        }
    })();

    await loadPromise;
}

/* ---------------------------------------------------------- */
/* -- Jump-to / deep links                                 -- */
/* ---------------------------------------------------------- */

/**
 * Keep loading pages until the jump target exists (or nothing left to load).
 * @param {string} domId e.g. `entry-<uuid>`
 * @returns {Promise<HTMLElement|null>}
 */
async function ensureEntryInDom(domId) {
    for (;;) {
        const el = document.getElementById(domId);
        if (el) return el;
        if (loading) {
            await loadPromise;
            continue;
        }
        if (!nextCursor) return null;
        await loadSessions(true);
    }
}

/** @returns {number} ms to wait for collapse animation (0 if already closed) */
function collapseJumpMenu() {
    if (!jumpSidebar?.classList.contains("is-open")) return 0;
    jumpSidebar.classList.remove("is-open");
    jumpToggle?.setAttribute("aria-expanded", "false");
    return JUMP_COLLAPSE_MS;
}

/** Prefer scrolling to a heading inside a wrapper, not the wrapper top alone. */
function scrollTargetFor(el) {
    if (
        el.matches(".session-title, .game-date-heading") ||
        !el.querySelector
    ) {
        return el;
    }
    return el.querySelector(".session-title, .game-date-heading") || el;
}

/**
 * Collapse jump menu, load-until-found, scroll, update hash.
 * @param {string} domId
 * @returns {Promise<boolean>}
 */
async function jumpToDomId(domId) {
    const waitCollapse = collapseJumpMenu();
    const el = await ensureEntryInDom(domId);
    if (!el) return false;
    if (waitCollapse) {
        await new Promise((r) => setTimeout(r, waitCollapse));
    }
    scrollTargetFor(el).scrollIntoView({ behavior: "instant", block: "start" });
    history.pushState(null, "", `#${domId}`);
    return true;
}

function renderJumpToList() {
    if (!tocData || !jumpToList) return;

    const showSessions = document.getElementById("session-check")?.checked !== false;
    const items = [];
    for (const session of tocData.sessions || []) {
        if (showSessions && session.showHeading !== false) {
            const sessionLabel = displaySessionTitle(session.title || "Session");
            items.push(
                `<li class="jump-session"><a href="#entry-${session.id}">${escapeHtml(sessionLabel)}</a></li>`,
            );
        }
        for (const d of session.dates || []) {
            // Prologue is a session heading only in the Jump-to UX (skip duplicate date row)
            if (d.dateKey === "prologue") continue;
            const label = d.title || d.dateKey;
            items.push(
                `<li class="jump-date"><a href="#entry-${d.anchorEntryId}">${escapeHtml(label)}</a></li>`,
            );
        }
    }
    jumpToList.innerHTML = items.join("");
    updateActiveJumpLink();
}

/** Strip leading IRL date + hyphen from TOC labels only (data unchanged). */
function displaySessionTitle(title) {
    const stripped = String(title)
        .replace(/^\d{1,2}\.\d{1,2}\.\d{2,4}\s*[-–—]\s*/, "")
        .trim();
    return stripped || title;
}

function escapeHtml(str) {
    return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

/* ---------------------------------------------------------- */
/* -- Jump scroll-spy (desktop)                            -- */
/* ---------------------------------------------------------- */

/** @returns {number} bottom edge of sticky header in viewport coords */
function headerBottomY() {
    const raw = getComputedStyle(document.documentElement)
        .getPropertyValue("--site-header-height")
        .trim();
    const fromVar = Number.parseFloat(raw);
    if (Number.isFinite(fromVar)) return fromVar;
    return document.getElementById("site-header")?.offsetHeight ?? 0;
}

/**
 * Bounding rects for visual paragraphs inside an entry-blocks container
 * (runs of nodes split by `.entry-para-break`).
 * @param {HTMLElement} entryBlocks
 * @returns {DOMRect[]}
 */
function paragraphRectsInBlocks(entryBlocks) {
    const rects = [];
    let paraStart = null;
    let paraEnd = null;

    const commit = () => {
        if (!paraStart || !paraEnd) return;
        const range = document.createRange();
        range.setStartBefore(paraStart);
        range.setEndAfter(paraEnd);
        const rect = range.getBoundingClientRect();
        if (rect.height > 1 && rect.width > 1) rects.push(rect);
        paraStart = paraEnd = null;
    };

    for (const node of entryBlocks.childNodes) {
        if (
            node.nodeType === Node.ELEMENT_NODE &&
            node.classList.contains("entry-para-break")
        ) {
            commit();
            continue;
        }
        if (!paraStart) paraStart = node;
        paraEnd = node;
    }
    commit();
    return rects;
}

/**
 * Content roots whose paragraphs "belong" to a Jump-to link.
 * Session links own prologue / undated chunks; date links own their article.
 * @param {string} domId
 * @returns {HTMLElement[]}
 */
function contentRootsForJumpId(domId) {
    const el = document.getElementById(domId);
    if (!el) return [];

    if (el.classList.contains("session-title")) {
        const session = el.closest(".session-block");
        if (!session) return [];
        return [...session.querySelectorAll(".game-date-entry")].filter((entry) => {
            const id =
                entry.id ||
                entry.querySelector(".game-date-heading")?.id ||
                "";
            if (!id) return true;
            return !jumpToList?.querySelector(`li.jump-date > a[href="#${id}"]`);
        });
    }

    if (el.classList.contains("game-date-heading")) {
        const article = el.closest(".game-date-entry");
        return article ? [article] : [];
    }

    if (el.classList.contains("game-date-entry")) return [el];
    return [];
}

/** @param {DOMRect} rect @returns {boolean} */
function isParagraphMeaningfullyVisible(rect) {
    const top = headerBottomY();
    const bottom = window.innerHeight;
    const visibleTop = Math.max(rect.top, top);
    const visibleBottom = Math.min(rect.bottom, bottom);
    const visibleH = visibleBottom - visibleTop;
    if (visibleH <= 0) return false;
    // Fully on-screen, or a solid readable chunk (long paras rarely fit entirely)
    if (rect.top >= top - 0.5 && rect.bottom <= bottom + 0.5) return true;
    return visibleH >= Math.min(rect.height * 0.28, 72) || visibleH >= 56;
}

/** Heading / anchor sits in the upper reading band below the header. */
function isAnchorInReadingBand(el) {
    const rect = el.getBoundingClientRect();
    const top = headerBottomY();
    const bandBottom = top + (window.innerHeight - top) * 0.42;
    return rect.bottom > top + 4 && rect.top < bandBottom;
}

/**
 * Highlight the earliest readable Jump target. When that content belongs to a
 * game-date, keep both the date and its parent session lit; when the hit is a
 * session heading with a visible child date, light that date too.
 */
function updateActiveJumpLink() {
    if (!jumpToList) return;
    if (!window.matchMedia("(min-width: 900px)").matches) {
        jumpToList.querySelectorAll("a.is-active").forEach((a) => {
            a.classList.remove("is-active");
        });
        return;
    }

    const links = [...jumpToList.querySelectorAll('a[href^="#entry-"]')];

    /** @param {HTMLAnchorElement} link */
    const linkIsReadable = (link) => {
        const domId = link.getAttribute("href")?.slice(1);
        if (!domId) return false;
        const anchor = document.getElementById(domId);
        const roots = contentRootsForJumpId(domId);
        const hasVisiblePara = roots.some((root) => {
            const blocks = root.querySelector(".entry-blocks");
            if (!blocks) return false;
            return paragraphRectsInBlocks(blocks).some(isParagraphMeaningfullyVisible);
        });
        return hasVisiblePara || Boolean(anchor && isAnchorInReadingBand(anchor));
    };

    /** @type {HTMLAnchorElement|null} */
    let primary = null;
    for (const link of links) {
        if (linkIsReadable(link)) {
            primary = link;
            break;
        }
    }

    /** @type {Set<HTMLAnchorElement>} */
    const activeSet = new Set();
    if (primary) {
        activeSet.add(primary);

        const dateItem = primary.closest("li.jump-date");
        const sessionItem = primary.closest("li.jump-session");

        if (dateItem) {
            let prev = dateItem.previousElementSibling;
            while (prev && !prev.classList.contains("jump-session")) {
                prev = prev.previousElementSibling;
            }
            const sessionLink = prev?.querySelector('a[href^="#entry-"]');
            if (sessionLink instanceof HTMLAnchorElement) activeSet.add(sessionLink);
        } else if (sessionItem) {
            let next = sessionItem.nextElementSibling;
            while (next && next.classList.contains("jump-date")) {
                const dateLink = next.querySelector('a[href^="#entry-"]');
                if (dateLink instanceof HTMLAnchorElement && linkIsReadable(dateLink)) {
                    activeSet.add(dateLink);
                    break;
                }
                next = next.nextElementSibling;
            }
        }
    }

    for (const link of links) {
        link.classList.toggle("is-active", activeSet.has(link));
    }

    if (primary) {
        const scroller = jumpSidebar?.querySelector(".jump-list-collapse");
        if (scroller) {
            const linkRect = primary.getBoundingClientRect();
            const box = scroller.getBoundingClientRect();
            if (linkRect.top < box.top || linkRect.bottom > box.bottom) {
                primary.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }
        }
    }
}

function setupJumpScrollSpy() {
    let ticking = false;
    const onScrollOrResize = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            updateActiveJumpLink();
            ticking = false;
        });
    };

    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize, { passive: true });
    updateActiveJumpLink();
}

/* ---------------------------------------------------------- */
/* -- UI chrome (back-to-top, toggles, format)             -- */
/* ---------------------------------------------------------- */

function setupBackToTop() {
    const btn = document.getElementById("back-to-top");
    const endBtn = document.getElementById("travelogue-end-top");

    const scrollToTop = () => {
        const intro = document.getElementById("travelogue-intro");
        if (intro) {
            intro.scrollIntoView({ behavior: "instant", block: "start" });
        } else {
            window.scrollTo({ top: 0, behavior: "instant" });
        }
    };

    endBtn?.addEventListener("click", scrollToTop);

    if (!btn) return;

    let lastY = window.scrollY;
    let visible = false;

    const setVisible = (show) => {
        if (show === visible) return;
        visible = show;
        btn.classList.toggle("is-visible", show);
        btn.setAttribute("aria-hidden", show ? "false" : "true");
    };

    const endInView = () => {
        if (!endBtn) return false;
        const rect = endBtn.getBoundingClientRect();
        return rect.top < window.innerHeight && rect.bottom > 0;
    };

    const onScroll = () => {
        const y = window.scrollY;
        const goingUp = y < lastY - 2;
        const farEnough = y > 1000;
        setVisible(goingUp && farEnough && !endInView());
        lastY = y;
    };

    syncFloatingBackToTop = () => {
        lastY = window.scrollY;
        if (endInView() || document.body.classList.contains("edit-mode") === false) {
            setVisible(false);
        }
    };

    window.addEventListener("scroll", onScroll, { passive: true });

    btn.addEventListener("click", () => {
        scrollToTop();
        setVisible(false);
    });
}

function setupJumpToggle() {
    jumpToggle?.addEventListener("click", () => {
        const open = jumpSidebar?.classList.toggle("is-open");
        jumpToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
}

function setupJumpLinks() {
    jumpToList?.addEventListener("click", (e) => {
        const link = e.target.closest("a[href^='#entry-']");
        if (!link) return;
        e.preventDefault();
        const domId = link.getAttribute("href")?.slice(1);
        if (!domId) return;
        jumpToDomId(domId);
    });
}

function setupFormatControls() {
    const sessionCheck = document.getElementById("session-check");
    const formatDropdown = document.getElementById("format-dropdown");

    sessionCheck?.addEventListener("change", () => {
        document.querySelectorAll(".session-title").forEach((el) => {
            el.classList.toggle("hidden", !sessionCheck.checked);
        });
        renderJumpToList();
    });

    formatDropdown?.addEventListener("change", () => {
        applyFormatToBlocks(document.getElementById("travelogue-sessions"));
    });
}

function syncLucyChrome() {
    document.body.classList.toggle("is-lucy", isLucy());
    const host = document.getElementById("checkboxes");
    if (!lucyCanAuthor()) {
        addSessionBtn?.remove();
        addSessionBtn = null;
        return;
    }
    if (!host) return;
    if (!addSessionBtn) {
        addSessionBtn = document.createElement("button");
        addSessionBtn.type = "button";
        addSessionBtn.className = "add-session-btn";
        addSessionBtn.textContent = "Add Session";
        addSessionBtn.addEventListener("click", () => {
            void addSession();
        });
    }
    host.appendChild(addSessionBtn);
}

function syncHeadingChrome() {
    document.querySelectorAll(".session-block").forEach((block) => {
        if (!(block instanceof HTMLElement)) return;
        block.querySelectorAll(".session-title, .game-date-heading").forEach((node) => {
            if (!(node instanceof HTMLElement)) return;
            if (!isEditMode() && node.dataset.savedTitle && node.textContent !== node.dataset.savedTitle) {
                node.textContent = node.dataset.savedTitle;
            }
        });
        applySessionRestore(block);
        block.querySelectorAll(".session-title, .game-date-heading").forEach((node) => {
            if (node instanceof HTMLElement) applyHeadingChrome(node);
        });
    });
}

function applySessionRestore(block) {
    const existing = block.querySelector(".log-heading-restore");
    if (!lucyCanAuthor() || block.dataset.headingHidden !== "1") {
        existing?.remove();
        return;
    }
    if (block.querySelector(".session-title") || existing) return;
    block.prepend(renderSessionRestore(block.dataset.entryId || "", block.dataset.headingTitle || ""));
}

function applyHeadingChrome(h) {
    const want = lucyCanAuthor();
    const row = h.closest(".log-heading");
    if (!want) {
        h.contentEditable = "false";
        if (row?.parentElement) row.replaceWith(h);
        return;
    }

    h.contentEditable = "true";
    h.spellcheck = true;
    if (!h.dataset.savedTitle) h.dataset.savedTitle = h.textContent || "";
    if (h.dataset.headingWired !== "1") {
        wireHeadingEditor(h);
        h.dataset.headingWired = "1";
    }
    if (row) return;

    const wrap = document.createElement("div");
    wrap.className = "log-heading";
    wrap.dataset.kind = h.classList.contains("session-title") ? "session" : "date";
    wrap.dataset.entryId = h.id.replace(/^entry-/, "");
    h.replaceWith(wrap);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "log-heading-remove";
    remove.setAttribute(
        "aria-label",
        h.classList.contains("session-title") ? "Remove session title" : "Remove date",
    );
    remove.textContent = "×";
    remove.addEventListener("pointerdown", (e) => {
        e.preventDefault();
    });
    remove.addEventListener("click", () => {
        void hideHeading(h, wrap.dataset.kind === "session" ? "session" : "date");
    });
    wrap.append(h, remove);
}

function focusHeadingText(el) {
    const h = el?.classList?.contains("log-heading")
        ? el.querySelector(".session-title, .game-date-heading")
        : el;
    if (!(h instanceof HTMLElement)) return;
    h.scrollIntoView({ behavior: "instant", block: "start" });
    h.focus();
    const range = document.createRange();
    range.selectNodeContents(h);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
}

function entryBlocksAfterHeading(h) {
    if (h.classList.contains("session-title")) {
        return h.closest(".session-block")?.querySelector(".entry-blocks") ?? null;
    }
    return h.closest(".game-date-entry")?.querySelector(".entry-blocks") ?? null;
}

function headingBaseline(h) {
    return h.dataset.baseTitle || h.dataset.savedTitle || "";
}

function wireHeadingEditor(h) {
    h.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            e.preventDefault();
            h.textContent = headingBaseline(h);
            h.blur();
            return;
        }
        if (e.key !== "Enter") return;
        e.preventDefault();
        normalizeHeadingText(h);
        placeCaretInNextProse(h);
    });
    h.addEventListener("paste", (e) => {
        e.preventDefault();
        const text = (e.clipboardData?.getData("text/plain") || "").replace(/\s+/g, " ");
        document.execCommand("insertText", false, text);
    });
    h.addEventListener("blur", () => {
        normalizeHeadingText(h);
    });
}

function normalizeHeadingText(h) {
    const title = (h.textContent || "").replace(/\s+/g, " ").trim();
    const baseline = headingBaseline(h);
    h.textContent = title || baseline;
}

function placeCaretInNextProse(h) {
    const container = entryBlocksAfterHeading(h);
    if (!container) return;
    container.closest(".game-date-entry")?.querySelector(".lucy-write-line")?.remove();
    container.closest(".session-block")?.querySelector(".lucy-write-line")?.remove();
    placeCaretAtProseStart(container);
    syncDateChip(document.activeElement);
}

function captureHeadingBase() {
    headingBase = new Map();
    document.querySelectorAll(".session-block").forEach((block) => {
        if (!(block instanceof HTMLElement) || !block.dataset.entryId) return;
        const titleEl = block.querySelector(".session-title");
        const title = (titleEl?.textContent || block.dataset.headingTitle || "").replace(/\s+/g, " ").trim();
        headingBase.set(block.dataset.entryId, {
            kind: "session",
            title,
            shown: block.dataset.headingHidden !== "1",
        });
        if (titleEl instanceof HTMLElement) {
            titleEl.dataset.baseTitle = title;
            titleEl.dataset.savedTitle = title;
        }
    });
    document.querySelectorAll(".game-date-entry").forEach((article) => {
        if (!(article instanceof HTMLElement) || !article.dataset.entryId) return;
        const titleEl = article.querySelector(".game-date-heading");
        const title = (titleEl?.textContent || "").replace(/\s+/g, " ").trim();
        headingBase.set(article.dataset.entryId, {
            kind: "date",
            title,
            shown: !!titleEl && article.dataset.pendingHide !== "1",
        });
        if (titleEl instanceof HTMLElement) {
            titleEl.dataset.baseTitle = title;
            titleEl.dataset.savedTitle = title;
        }
    });
}

function showDateHeading(article, id, title) {
    const heading = renderHeading({
        kind: "date",
        id,
        title: title || "New date",
        showHeading: true,
    });
    if (!heading) return;
    const old = article.querySelector(".log-heading, .game-date-heading");
    if (old) old.replaceWith(heading);
    else article.prepend(heading);
    if (article.id === `entry-${id}`) article.removeAttribute("id");
    delete article.dataset.pendingHide;
}

async function savePendingHeadings() {
    try {
        for (const block of document.querySelectorAll(".session-block")) {
            if (!(block instanceof HTMLElement) || !block.dataset.entryId) continue;
            const id = block.dataset.entryId;
            const base = headingBase.get(id);
            const titleEl = block.querySelector(".session-title");
            const shown = block.dataset.headingHidden !== "1";
            const title = (shown ? titleEl?.textContent || "" : block.dataset.headingTitle || "")
                .replace(/\s+/g, " ")
                .trim();
            const baseTitle =
                base?.title ?? titleEl?.dataset.savedTitle ?? block.dataset.persistedTitle ?? "";
            const baseShown = base ? base.shown : true;
            /** @type {{ title?: string, showHeading?: boolean }} */
            const body = {};
            if (title && title !== baseTitle) body.title = title;
            if (shown !== baseShown) body.showHeading = shown;
            if (!body.title && body.showHeading === undefined) continue;
            const data = await apiPatch(`/travelogue/headings/${id}`, body);
            const saved = data.entry.title || title;
            if (titleEl instanceof HTMLElement) {
                titleEl.dataset.savedTitle = saved;
                titleEl.dataset.baseTitle = saved;
            }
            block.dataset.persistedTitle = saved;
            block.dataset.headingTitle = title || saved;
        }

        for (const article of document.querySelectorAll(".game-date-entry")) {
            if (!(article instanceof HTMLElement) || !article.dataset.entryId) continue;
            const id = article.dataset.entryId;
            const base = headingBase.get(id);
            const titleEl = article.querySelector(".game-date-heading");
            const pendingHide = article.dataset.pendingHide === "1";
            const title = (pendingHide ? article.dataset.hiddenTitle || "" : titleEl?.textContent || "")
                .replace(/\s+/g, " ")
                .trim();
            const baseTitle = base?.title ?? article.dataset.restoreTitle ?? titleEl?.dataset.savedTitle ?? "";
            /** @type {{ title?: string, showHeading?: boolean }} */
            const body = {};
            if (title && title !== baseTitle) body.title = title;
            if (pendingHide) body.showHeading = false;
            if (!body.title && body.showHeading === undefined) continue;
            const data = await apiPatch(`/travelogue/headings/${id}`, body);
            if (pendingHide) {
                applySavedDateHide(article, data);
            } else if (titleEl instanceof HTMLElement) {
                const saved = data.entry.title || title;
                titleEl.dataset.savedTitle = saved;
                titleEl.dataset.baseTitle = saved;
            }
        }

        await refreshToc();
        return true;
    } catch (err) {
        alert(err.data?.error || err.message || "Could not save heading");
        return false;
    }
}

function applySavedDateHide(article, data) {
    if (data.previous) {
        const previousBlocks = document.querySelector(
            `.entry-blocks[data-entry-id="${data.previous.id}"]`,
        );
        if (previousBlocks instanceof HTMLElement) {
            renderEntryBlocks(previousBlocks, data.previous, { editable: true });
        }
        article.remove();
        return;
    }
    article.querySelector(".log-heading, .game-date-heading")?.remove();
    if (!article.querySelector(".game-date-heading")) {
        article.id = `entry-${article.dataset.entryId}`;
    }
    delete article.dataset.pendingHide;
}

function discardHeadingEdits() {
    document.querySelectorAll(".session-block").forEach((block) => {
        if (!(block instanceof HTMLElement) || !block.dataset.entryId) return;
        const base = headingBase.get(block.dataset.entryId);
        const titleEl = block.querySelector(".session-title");
        const title =
            base?.title ??
            block.dataset.persistedTitle ??
            titleEl?.dataset.savedTitle ??
            block.dataset.headingTitle ??
            "";
        const shown = base ? base.shown : true;
        block.dataset.headingHidden = shown ? "0" : "1";
        block.dataset.headingTitle = title;
        block.querySelector(".log-heading-restore")?.remove();
        const existing = block.querySelector(".log-heading, .session-title");
        if (shown && title) {
            const heading = renderHeading({
                kind: "session",
                id: block.dataset.entryId,
                title,
                showHeading: true,
            });
            if (existing) existing.replaceWith(heading);
            else block.prepend(heading);
        } else {
            existing?.remove();
        }
    });

    document.querySelectorAll(".game-date-entry").forEach((article) => {
        if (!(article instanceof HTMLElement) || !article.dataset.entryId) return;
        const base = headingBase.get(article.dataset.entryId);
        const titleEl = article.querySelector(".game-date-heading");
        const shown = base ? base.shown : true;
        const title =
            base?.title ||
            article.dataset.restoreTitle ||
            titleEl?.dataset.savedTitle ||
            article.dataset.hiddenTitle ||
            "";
        delete article.dataset.pendingHide;
        delete article.dataset.hiddenTitle;
        delete article.dataset.restoreTitle;
        if (shown && title) showDateHeading(article, article.dataset.entryId, title);
        else if (!shown) article.querySelector(".log-heading, .game-date-heading")?.remove();
    });
}

function hideHeading(h, kind) {
    void (async () => {
        const ok = await showRemoveHeadingModal({ kind });
        if (!ok) return;
        const id = h.id.replace(/^entry-/, "");
        const title = (h.textContent || "").replace(/\s+/g, " ").trim() || headingBaseline(h);
        const row = h.closest(".log-heading") || h;
        if (kind === "date") {
            const article = h.closest(".game-date-entry");
            if (article instanceof HTMLElement) {
                article.dataset.pendingHide = "1";
                article.dataset.hiddenTitle = title;
                article.dataset.restoreTitle = headingBaseline(h);
                article.id = `entry-${id}`;
            }
            row.remove();
            return;
        }
        const session = h.closest(".session-block");
        if (session instanceof HTMLElement) {
            session.dataset.entryId = id;
            session.dataset.headingHidden = "1";
            session.dataset.headingTitle = title;
            session.dataset.persistedTitle = h.dataset.savedTitle || headingBaseline(h);
        }
        row.remove();
        if (session instanceof HTMLElement) applySessionRestore(session);
    })();
}

function restoreHeading(btn) {
    const id = btn.dataset.entryId;
    const title = btn.dataset.title || "";
    const heading = renderHeading({
        kind: "session",
        id,
        title,
        showHeading: true,
    });
    if (!heading) return;
    const session = btn.closest(".session-block");
    if (session instanceof HTMLElement) {
        session.dataset.headingHidden = "0";
        session.dataset.headingTitle = title;
    }
    btn.replaceWith(heading);
    focusHeadingText(heading);
}

async function startWriting(container, { at = "end" } = {}) {
    if (!container) return;
    if (!ensureEditMode()) return;
    container.closest(".game-date-entry")?.querySelector(".lucy-write-line")?.remove();
    beginWritingInEntry(container, { at });
    syncDateChip(document.activeElement);
}

function syncSessionWriteLine(sessionBlock) {
    sessionBlock.querySelectorAll(".lucy-write-line").forEach((el) => el.remove());
    if (!lucyCanAuthor()) return;
    if (sessionBlock.querySelector(".entry-block")) return;
    const article = sessionBlock.querySelector(".game-date-entry");
    const container = article?.querySelector(".entry-blocks");
    if (!article || !container) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lucy-write-line";
    btn.textContent = "Write…";
    btn.addEventListener("click", () => {
        void startWriting(container, { at: "end" });
    });
    article.appendChild(btn);
}

function syncAllWriteLines() {
    document.querySelectorAll(".session-block").forEach((block) => {
        if (block instanceof HTMLElement) syncSessionWriteLine(block);
    });
}

function nextEntryBlock(span) {
    let node = span.nextSibling;
    while (node) {
        if (node instanceof HTMLElement && node.classList.contains("entry-block")) return node;
        node = node.nextSibling;
    }
    return null;
}

function isBlankBlock(span) {
    return !(span.textContent || "").replaceAll("\u200B", "").trim();
}

function isSolitaryEmptyLucyParagraph(span) {
    if (!(span instanceof HTMLElement)) return false;
    if (!lucyCanAuthor()) return false;
    if (!span.classList.contains("entry-block") || !span.classList.contains("voice-lucy")) return false;
    if (!span.isContentEditable) return false;
    const writer = getCurrentWriter();
    if (!writer || span.dataset.writerId !== writer.id) return false;
    if (!isBlankBlock(span)) return false;

    const container = span.parentElement;
    if (!container) return false;
    const blocks = [...container.children].filter(
        (el) => el instanceof HTMLElement && el.classList.contains("entry-block"),
    );
    const idx = blocks.indexOf(span);
    if (idx < 0) return false;
    const prev = blocks[idx - 1] || null;
    const next = blocks[idx + 1] || null;
    const starts = !prev || span.dataset.startsParagraph === "true";
    const ends = !next || next.dataset.startsParagraph === "true";
    return starts && ends;
}

function ensureDateChip() {
    if (dateChip) return dateChip;
    dateChip = document.createElement("button");
    dateChip.type = "button";
    dateChip.className = "insert-date-chip";
    dateChip.hidden = true;
    dateChip.textContent = "Insert game date here";
    dateChip.addEventListener("pointerdown", (e) => {
        e.preventDefault();
    });
    dateChip.addEventListener("click", () => {
        const span = dateChip?._span;
        if (span) void insertGameDateAt(span);
    });
    return dateChip;
}

function hideDateChip() {
    if (!dateChip) return;
    dateChip.hidden = true;
    dateChip.classList.remove("is-below");
    dateChip._span?.closest(".game-date-entry")?.classList.remove("has-date-chip-below");
    dateChip._span = null;
}

function showDateChipFor(span) {
    const chip = ensureDateChip();
    const article = span.closest(".game-date-entry");
    if (!article) return;
    chip._span?.closest(".game-date-entry")?.classList.remove("has-date-chip-below");
    if (chip.parentElement !== article) article.appendChild(chip);
    chip.hidden = false;
    placeDateChip(chip, span, article);
    chip._span = span;
}

function placeDateChip(chip, span, article) {
    const gap = 10;
    const spanRect = span.getBoundingClientRect();
    const artRect = article.getBoundingClientRect();
    const chipWidth = chip.offsetWidth;
    const chipHeight = chip.offsetHeight;
    const besideLeft = spanRect.right - artRect.left + gap;
    const fitsBeside = besideLeft + chipWidth <= artRect.width - 4;

    chip.classList.toggle("is-below", !fitsBeside);
    article.classList.toggle("has-date-chip-below", !fitsBeside);

    if (fitsBeside) {
        chip.style.right = "";
        chip.style.left = `${besideLeft}px`;
        chip.style.top = `${spanRect.top - artRect.top + (spanRect.height - chipHeight) / 2}px`;
        return;
    }

    const right = Math.max(0, artRect.right - spanRect.right);
    chip.style.left = "auto";
    chip.style.right = `${right}px`;
    chip.style.top = `${spanRect.bottom - artRect.top + 2}px`;
}

function syncDateChip(target) {
    if (isSolitaryEmptyLucyParagraph(target)) {
        showDateChipFor(target);
        return;
    }
    if (dateChip?._span && !isSolitaryEmptyLucyParagraph(dateChip._span)) hideDateChip();
}

async function insertGameDateAt(span) {
    const container = span.closest(".entry-blocks");
    if (!container) return;
    const entryId = container.dataset.entryId;
    const next = nextEntryBlock(span);
    const beforeSortRank = next?.dataset.sortRank || null;
    const writeAt = next ? "start" : "end";

    span.dataset.discarded = "1";
    span.remove();
    hideDateChip();

    const saved = await saveEntryBlocks(container, {
        id: entryId,
        version: Number(container.dataset.version || 1),
    });
    if (!saved) return;

    try {
        const data = await apiPost("/travelogue/dates/insert", {
            entryId,
            beforeSortRank,
        });
        applyInsertedDate(container, data, writeAt);
        await refreshToc();
    } catch (err) {
        alert(err.data?.error || err.message || "Could not insert game date");
    }
}

function placeRevivedDate(sourceArticle, data) {
    const existing = document.querySelector(
        `.game-date-entry[data-entry-id="${data.gameDate.id}"]`,
    );
    let article = existing instanceof HTMLElement ? existing : null;
    if (!article) {
        article = renderGameDateEntry(data.gameDate, isEditMode());
        if (data.place === "before") sourceArticle.before(article);
        else sourceArticle.after(article);
    } else {
        const heading = renderHeading({
            kind: "date",
            id: data.gameDate.id,
            title: data.gameDate.title || "New date",
            showHeading: true,
        });
        const old = article.querySelector(".log-heading, .game-date-heading");
        if (old) old.replaceWith(heading);
        else article.prepend(heading);
        if (article.id === `entry-${data.gameDate.id}`) article.removeAttribute("id");
        const blocks = article.querySelector(".entry-blocks");
        if (blocks instanceof HTMLElement) {
            renderEntryBlocks(blocks, data.gameDate, { editable: isEditMode() });
        }
    }
    article.dataset.writeAt = "end";
    focusHeadingText(article.querySelector(".game-date-heading"));
}

function applyInsertedDate(sourceContainer, data, writeAt) {
    const sourceArticle = sourceContainer.closest(".game-date-entry");
    const sessionBlock = sourceContainer.closest(".session-block");
    if (!sourceArticle || !data.gameDate) return;

    if (data.mode === "revive") {
        placeRevivedDate(sourceArticle, data);
        if (sessionBlock instanceof HTMLElement) syncSessionWriteLine(sessionBlock);
        return;
    }

    if (data.mode === "promote") {
        const heading = renderHeading({
            kind: "date",
            id: data.gameDate.id,
            title: data.gameDate.title || "New date",
            showHeading: true,
        });
        const existing = sourceArticle.querySelector(".log-heading, .game-date-heading, .log-heading-restore");
        if (existing) existing.replaceWith(heading);
        else sourceArticle.prepend(heading);
        if (sourceArticle.id === `entry-${data.gameDate.id}`) sourceArticle.removeAttribute("id");
        focusHeadingText(heading);
        if (sessionBlock instanceof HTMLElement) syncSessionWriteLine(sessionBlock);
        return;
    }

    if (data.source && data.source.id === sourceContainer.dataset.entryId) {
        renderEntryBlocks(sourceContainer, data.source, { editable: isEditMode() });
    }

    const article = renderGameDateEntry(data.gameDate, isEditMode());
    article.dataset.writeAt = writeAt;
    sourceArticle.after(article);
    focusHeadingText(article.querySelector(".game-date-heading"));
    if (sessionBlock instanceof HTMLElement) syncSessionWriteLine(sessionBlock);
}

async function addSession() {
    if (!lucyCanAuthor() || !addSessionBtn) return;
    addSessionBtn.disabled = true;
    try {
        const data = await apiPost("/travelogue/sessions", { title: defaultSessionTitle() });
        const session = data.session;
        await refreshToc();

        let heading = document.getElementById(`entry-${session.id}`);
        if (!heading) {
            if (nextCursor) {
                await ensureEntryInDom(`entry-${session.id}`);
            } else if (sessionsContainer) {
                sessionsContainer.appendChild(renderSession(session, isEditMode()));
            }
            heading = document.getElementById(`entry-${session.id}`);
        }
        if (!heading) {
            nextCursor = null;
            await loadSessions(false);
            heading = await ensureEntryInDom(`entry-${session.id}`);
        }
        focusHeadingText(heading);
    } catch (err) {
        alert(err.data?.error || err.message || "Could not create session");
    } finally {
        if (addSessionBtn) addSessionBtn.disabled = false;
    }
}

async function refreshToc() {
    tocData = await apiGet("/travelogue/toc");
    renderJumpToList();
}

/* ---------------------------------------------------------- */
/* -- Page boot                                            -- */
/* ---------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", async () => {
    await initAuth();
    initEditChrome();
    setHeadingEditHandlers({
        capture: captureHeadingBase,
        save: savePendingHeadings,
        discard: discardHeadingEdits,
    });

    try {
        await refreshToc();
    } catch (err) {
        console.error("TOC load failed", err);
    }

    await loadSessions(false);
    setupFormatControls();
    setupJumpToggle();
    setupJumpLinks();
    setupJumpScrollSpy();
    setupBackToTop();
    setupInfiniteScroll();
    syncLucyChrome();
    sessionsContainer?.addEventListener("focusin", (e) => {
        syncDateChip(e.target);
    });
    sessionsContainer?.addEventListener("input", (e) => {
        syncDateChip(e.target);
        const block = e.target instanceof Element ? e.target.closest(".session-block") : null;
        if (block instanceof HTMLElement) syncSessionWriteLine(block);
    });
    sessionsContainer?.addEventListener("focusout", () => {
        setTimeout(() => {
            syncDateChip(document.activeElement);
            syncAllWriteLines();
        }, 0);
    });
    const repositionDateChip = () => syncDateChip(dateChip?._span);
    window.addEventListener("scroll", repositionDateChip, true);
    window.visualViewport?.addEventListener("resize", repositionDateChip);
    window.visualViewport?.addEventListener("scroll", repositionDateChip);
    window.addEventListener("resize", () => {
        syncLucyChrome();
        syncHeadingChrome();
        syncDateChip(dateChip?._span);
        syncAllWriteLines();
    });
    onEditModeChange(() => {
        hideDateChip();
        syncLucyChrome();
        syncHeadingChrome();
        syncAllWriteLines();
        requestAnimationFrame(() => {
            requestAnimationFrame(() => syncFloatingBackToTop());
        });
    });

    // Deep-link support: #entry-… may point at a not-yet-loaded session
    const hashId = location.hash?.replace(/^#/, "");
    if (hashId?.startsWith("entry-")) {
        await jumpToDomId(hashId);
    }

    loadMoreBtn?.addEventListener("click", () => loadSessions(true));

    onAuthChange(() => {
        syncLucyChrome();
        // Avoid wiping in-progress edits when login unlocks Edit mode
        if (!isEditMode()) loadSessions(false);
    });
});
