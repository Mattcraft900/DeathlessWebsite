/**
 * Site header + hamburger nav (every page). Builds DOM into `#site-header`,
 * then kicks off `initAuth()` so the session cookie is restored early.
 */

import { initAuth } from "./auth-ui.js";

function buildHeader() {
  const header = document.getElementById("site-header");
  if (!header) return;

  const backdrop = document.createElement("div");
  backdrop.className = "menu-backdrop";
  backdrop.setAttribute("aria-hidden", "true");

  const inner = document.createElement("div");
  inner.className = "header-inner";

  const menuBtn = document.createElement("button");
  menuBtn.id = "menu-btn";
  menuBtn.type = "button";
  menuBtn.setAttribute("aria-label", "Menu");
  menuBtn.setAttribute("aria-expanded", "false");
  menuBtn.setAttribute("aria-controls", "menu-list");
  menuBtn.innerHTML = `
    <div class="bar1"></div>
    <div class="bar2"></div>
    <div class="bar3"></div>
  `;

  const navCollapse = document.createElement("div");
  navCollapse.className = "nav-collapse";

  const nav = document.createElement("nav");
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
  inner.append(menuBtn, navCollapse);
  header.append(backdrop, inner);

  initAuth();
}

document.addEventListener("DOMContentLoaded", buildHeader);
