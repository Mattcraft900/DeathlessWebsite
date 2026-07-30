/**
 * Travelogue page: paginated sessions, infinite scroll, Jump-to TOC, format
 * controls, admin "new session", back-to-top, and deep-link hashes.
 *
 * Sessions load in pages (`limit=3`) with a cursor (`after`). Jump-to may need
 * a session that isn't loaded yet — `ensureEntryInDom` keeps appending until
 * the target id appears or there is no next page. Deep links (`#entry-…`) use
 * the same path after first paint.
 */

import { apiGet, apiPost } from "./api.js";
import { getCurrentWriter, initAuth, onAuthChange } from "./auth-ui.js";
import { applyFormatToBlocks, renderEntryBlocks } from "./blocks.js";
import { initEditChrome, isEditMode } from "./edit-chrome.js";

/* ---------------------------------------------------------- */
/* -- Page elements & state                                -- */
/* ---------------------------------------------------------- */

const sessionsContainer = document.getElementById("travelogue-sessions");
const loadMoreBtn = document.getElementById("load-more-btn");
const jumpToList = document.getElementById("jump-to-list");
const jumpSidebar = document.getElementById("jump-sidebar");
const jumpToggle = document.getElementById("jump-toggle");
const adminPanel = document.getElementById("admin-session-panel");
const newSessionForm = document.getElementById("new-session-form");

/** Wait after closing the jump menu before scrolling (CSS transition). */
const JUMP_COLLAPSE_MS = 320;

let nextCursor = null;
let loading = false;
let loadPromise = null;
let tocData = null;
let sentinelObserver = null;

/** @returns {"simple"|"stylized"} */
function getFormatMode() {
  const dropdown = document.getElementById("format-dropdown");
  return dropdown?.value === "simple" ? "simple" : "stylized";
}

/* ---------------------------------------------------------- */
/* -- Session / entry DOM                                  -- */
/* ---------------------------------------------------------- */

function renderSessionTitle(session) {
  const h = document.createElement("h3");
  h.className = `session-title ${getFormatMode()}`;
  h.id = `entry-${session.id}`;
  h.textContent = session.title || "Session";
  return h;
}

function renderGameDateHeading(chunk) {
  if (!chunk.showHeading || !chunk.title) return null;
  const h = document.createElement("h4");
  h.className = `game-date-heading voice-lucy ${getFormatMode()}`;
  h.id = `entry-${chunk.id}`;
  h.textContent = chunk.title;
  return h;
}

function renderGameDateEntry(chunk, editable) {
  const wrap = document.createElement("article");
  wrap.className = "game-date-entry";

  const heading = renderGameDateHeading(chunk);
  if (heading) {
    wrap.appendChild(heading);
  } else {
    // No visible heading — anchor the chunk wrapper itself for Jump-to / hashes
    wrap.id = `entry-${chunk.id}`;
  }

  const blocksEl = document.createElement("div");
  renderEntryBlocks(blocksEl, chunk, { editable });
  wrap.appendChild(blocksEl);
  return wrap;
}

function renderSession(session, editable) {
  const block = document.createElement("section");
  block.className = "session-block";
  block.dataset.sortRank = session.sortRank;
  block.appendChild(renderSessionTitle(session));

  for (const chunk of session.gameDates || []) {
    block.appendChild(renderGameDateEntry(chunk, editable));
  }

  const sessionCheck = document.getElementById("session-check");
  if (sessionCheck && !sessionCheck.checked) {
    block.querySelector(".session-title")?.classList.add("hidden");
  }

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
  if (loadMoreBtn) loadMoreBtn.disabled = true;

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
        loadMoreBtn.classList.toggle("hidden", !nextCursor);
        loadMoreBtn.disabled = false;
      }
    } catch (err) {
      console.error(err);
      if (!append) {
        sessionsContainer.innerHTML = `<p>Could not load travelogue.</p>`;
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

  const items = [];
  for (const session of tocData.sessions || []) {
    items.push(
      `<li class="jump-session"><a href="#entry-${session.id}">${escapeHtml(session.title || "Session")}</a></li>`,
    );
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
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/* ---------------------------------------------------------- */
/* -- UI chrome (back-to-top, toggles, format)             -- */
/* ---------------------------------------------------------- */

function setupBackToTop() {
  const btn = document.getElementById("back-to-top");
  if (!btn) return;

  let lastY = window.scrollY;
  let visible = false;

  const setVisible = (show) => {
    if (show === visible) return;
    visible = show;
    btn.classList.toggle("is-visible", show);
    btn.setAttribute("aria-hidden", show ? "false" : "true");
  };

  const onScroll = () => {
    const y = window.scrollY;
    const goingUp = y < lastY;
    const farEnough = y > 1000;
    setVisible(goingUp && farEnough);
    lastY = y;
  };

  window.addEventListener("scroll", onScroll, { passive: true });

  btn.addEventListener("click", () => {
    const filters = document.getElementById("format-sidebar");
    if (filters) {
      filters.scrollIntoView({ behavior: "instant", block: "start" });
    } else {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
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
  });

  formatDropdown?.addEventListener("change", () => {
    applyFormatToBlocks(document.getElementById("travelogue-sessions"));
  });
}

function updateAdminPanel() {
  const writer = getCurrentWriter();
  if (!adminPanel) return;
  adminPanel.classList.toggle("hidden", !(writer && writer.isAdmin));
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

  try {
    await refreshToc();
  } catch (err) {
    console.error("TOC load failed", err);
  }

  await loadSessions(false);
  setupFormatControls();
  setupJumpToggle();
  setupJumpLinks();
  setupBackToTop();
  setupInfiniteScroll();
  updateAdminPanel();

  // Deep-link support: #entry-… may point at a not-yet-loaded session
  const hashId = location.hash?.replace(/^#/, "");
  if (hashId?.startsWith("entry-")) {
    await jumpToDomId(hashId);
  }

  loadMoreBtn?.addEventListener("click", () => loadSessions(true));

  newSessionForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const titleInput = document.getElementById("new-session-title");
    const title = titleInput?.value?.trim();
    if (!title) return;
    try {
      await apiPost("/travelogue/sessions", {
        title,
        createEmptyDate: true,
        showHeading: false,
        dateTitle: title,
      });
      titleInput.value = "";
      await refreshToc();
      nextCursor = null;
      await loadSessions(false);
    } catch (err) {
      alert(err.data?.error || err.message || "Could not create session");
    }
  });

  onAuthChange(() => {
    updateAdminPanel();
    // Avoid wiping in-progress edits when login unlocks Edit mode
    if (!isEditMode()) loadSessions(false);
  });
});
