import { initAuth } from "./auth-ui.js";

function buildHeader() {
  const header = document.getElementById("site-header");
  if (!header) return;

  const inner = document.createElement("div");
  inner.className = "header-inner";

  const menuBtn = document.createElement("button");
  menuBtn.id = "menu-btn";
  menuBtn.setAttribute("aria-label", "Menu");
  menuBtn.innerHTML = `
    <div class="bar1"></div>
    <div class="bar2"></div>
    <div class="bar3"></div>
  `;

  const nav = document.createElement("nav");
  const menuList = document.createElement("ul");
  menuList.id = "menu-list";
  menuList.innerHTML = `
    <li class="nav-link"><a href="/">Home</a></li>
    <li class="nav-link"><a href="/travelogue">Campaign Log</a></li>
    <li class="nav-link"><a href="/characters">Characters</a></li>
  `;

  menuBtn.addEventListener("click", () => {
    menuBtn.classList.toggle("opened");
    nav.classList.toggle("shown");
  });

  nav.appendChild(menuList);
  inner.append(menuBtn, nav);
  header.appendChild(inner);

  initAuth();
}

document.addEventListener("DOMContentLoaded", buildHeader);
