/**
 * Site header + hamburger nav (every page). Builds DOM into `#site-header`,
 * then kicks off `initAuth()` so the session cookie is restored early.
 */

import { getCurrentWriter, initAuth, promptLogin } from "./auth-ui.js";

function ensureSkipLink() {
    if (document.querySelector(".skip-link")) return;
    const skip = document.createElement("a");
    skip.className = "skip-link";
    skip.href = "#main-content";
    skip.textContent = "Skip to main content";
    document.body.insertBefore(skip, document.body.firstChild);
}

async function openSettings() {
    if (window.location.pathname === "/settings") return;
    await initAuth();
    if (!getCurrentWriter()) {
        const writer = await promptLogin();
        if (!writer) return;
    }
    window.location.assign("/settings");
}

function buildHeader() {
    ensureSkipLink();

    const header = document.getElementById("site-header");
    if (!header) return;

    const backdrop = document.createElement("div");
    backdrop.className = "menu-backdrop";
    backdrop.setAttribute("aria-hidden", "true");

    const inner = document.createElement("div");
    inner.className = "header-inner";

    const settingsBtn = document.createElement("button");
    settingsBtn.id = "settings-btn";
    settingsBtn.type = "button";
    settingsBtn.setAttribute("aria-label", "Settings");
    settingsBtn.innerHTML = `
        <svg class="settings-btn__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.2 7.2 0 0 0-1.62-.94l-.36-2.54A.48.48 0 0 0 14 2h-4a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.55-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.65 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.77 14.5a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.3.59.22l2.39-.96c.5.39 1.04.71 1.62.94l.36 2.54c.05.24.24.41.48.41h4c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.55 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/>
        </svg>
    `;
    settingsBtn.addEventListener("click", () => {
        void openSettings();
    });

    const menuBtn = document.createElement("button");
    menuBtn.id = "menu-btn";
    menuBtn.type = "button";
    menuBtn.setAttribute("aria-label", "Menu");
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.setAttribute("aria-controls", "menu-list");
    menuBtn.innerHTML = `
        <span class="bar1" aria-hidden="true"></span>
        <span class="bar2" aria-hidden="true"></span>
        <span class="bar3" aria-hidden="true"></span>
    `;

    const navCollapse = document.createElement("div");
    navCollapse.className = "nav-collapse";

    const nav = document.createElement("nav");
    nav.setAttribute("aria-label", "Main");
    const menuList = document.createElement("ul");
    menuList.id = "menu-list";
    menuList.innerHTML = `
        <li class="nav-link"><a href="/">Home</a></li>
        <li class="nav-link"><a href="/travelogue">Campaign Log</a></li>
        <li class="nav-link"><a href="/characters">Characters</a></li>
    `;

    function setMenuOpen(open) {
        header.classList.toggle("menu-open", open);
        menuBtn.classList.toggle("opened", open);
        menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
        menuBtn.setAttribute("aria-label", open ? "Close menu" : "Menu");
        backdrop.setAttribute("aria-hidden", open ? "false" : "true");
    }

    menuBtn.addEventListener("click", () => {
        setMenuOpen(!header.classList.contains("menu-open"));
    });

    backdrop.addEventListener("click", () => setMenuOpen(false));

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && header.classList.contains("menu-open")) {
            setMenuOpen(false);
            menuBtn.focus();
        }
    });

    // If the viewport crosses into desktop layout, force the menu closed
    // (desktop nav is always visible — don't leave mobile-open state stuck).
    const desktopMq = window.matchMedia("(min-width: 600px)");
    const onViewportChange = () => {
        if (desktopMq.matches) setMenuOpen(false);
    };
    desktopMq.addEventListener("change", onViewportChange);

    nav.appendChild(menuList);
    navCollapse.appendChild(nav);
    inner.append(settingsBtn, menuBtn, navCollapse);
    header.append(backdrop, inner);

    const syncHeaderHeight = () => {
        document.documentElement.style.setProperty(
            "--site-header-height",
            `${header.offsetHeight}px`,
        );
    };
    syncHeaderHeight();
    new ResizeObserver(syncHeaderHeight).observe(header);

    initAuth();
}

document.addEventListener("DOMContentLoaded", buildHeader);
