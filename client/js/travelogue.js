import { apiGet, apiPost } from "./api.js";
import { getCurrentWriter, initAuth, onAuthChange } from "./auth-ui.js";
import { applyFormatToBlocks, renderEntryBlocks } from "./blocks.js";
import { initEditChrome, isEditMode } from "./edit-chrome.js";

const sessionsContainer = document.getElementById("travelogue-sessions");
const loadMoreBtn = document.getElementById("load-more-btn");
const sessionsSidebar = document.getElementById("sessions-sidebar-list");
const datesSidebar = document.getElementById("dates-sidebar-list");
const adminPanel = document.getElementById("admin-session-panel");
const newSessionForm = document.getElementById("new-session-form");

let nextCursor = null;
let loading = false;
let tocData = null;
let sentinelObserver = null;

function getFormatMode() {
  const dropdown = document.getElementById("format-dropdown");
  return dropdown?.value === "simple" ? "simple" : "stylized";
}

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
  wrap.id = `entry-${chunk.id}`;

  const heading = renderGameDateHeading(chunk);
  if (heading) wrap.appendChild(heading);

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
  return block;
}

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

async function loadSessions(append = false) {
  if (loading) return;
  loading = true;
  if (loadMoreBtn) loadMoreBtn.disabled = true;

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
}

function renderSidebars() {
  if (!tocData) return;

  if (sessionsSidebar) {
    sessionsSidebar.innerHTML = tocData.sessions
      .map(
        (s) =>
          `<li><a href="#entry-${s.id}">${escapeHtml(s.title || "Session")}</a></li>`,
      )
      .join("");
  }

  if (datesSidebar) {
    datesSidebar.innerHTML = tocData.dates
      .map((d) => {
        const label =
          d.dateKey === "prologue"
            ? "Prologue"
            : d.title || d.dateKey;
        return `<li><a href="#entry-${d.anchorEntryId}">${escapeHtml(label)}</a></li>`;
      })
      .join("");
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
  renderSidebars();
}

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
  setupInfiniteScroll();
  updateAdminPanel();

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
