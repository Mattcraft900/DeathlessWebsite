import { apiGet } from "./api.js";
import { initAuth, onAuthChange } from "./auth-ui.js";
import { applyFormatToBlocks, renderEntryBlocks } from "./blocks.js";
import { attachDetailPortrait } from "./character-images.js";
import { initEditChrome, isEditMode } from "./edit-chrome.js";

function classesToString(classes) {
  if (!classes?.length) return "";
  return classes
    .map((c) => {
      const name = c.class
        .toLowerCase()
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      return `${name} ${c.level}`;
    })
    .join(" / ");
}

function getSlugFromPath() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("characters");
  return idx >= 0 ? parts[idx + 1] : null;
}

function showNotFound(main) {
  main.innerHTML = `
    <div id="char-not-found">
      <p>Oops!<br>Looks like this record doesn't exist.</p>
      <a href="/characters">Back to Character List</a>
    </div>
  `;
}

function renderCharacter(main, data) {
  const { character, bio } = data;
  const editable = isEditMode();

  main.innerHTML = `
    <h1 id="character-name"></h1>
    <img id="character-img" class="hidden" alt="">
    <dl id="stats-list"></dl>
    <div id="dropdown-div">
      <label for="format-dropdown">Formatting:</label>
      <select id="format-dropdown" class="dropdown">
        <option value="simple">Simple</option>
        <option value="stylized" selected>Stylized</option>
      </select>
    </div>
    <div id="character-description"></div>
  `;

  document.getElementById("character-name").textContent = character.name;

  const img = document.getElementById("character-img");
  attachDetailPortrait(img, character.slug, character.name);

  const stats = document.getElementById("stats-list");
  const addStat = (label, value) => {
    if (!value) return;
    const dt = document.createElement("dt");
    dt.className = "stat-name";
    dt.textContent = `${label}: `;
    const dd = document.createElement("dd");
    dd.className = "stat-value";
    dd.textContent = value;
    stats.append(dt, dd);
  };

  if (character.fullName && character.fullName !== character.name) {
    addStat("Full name", character.fullName);
  }
  addStat("Age", character.age);
  addStat("Species", character.species);
  addStat("Gender", character.gender);

  if (character.category === "party") {
    addStat("Player", character.playerName);
    addStat("Class", classesToString(character.classes));
  } else if (character.category === "opc") {
    addStat("Original player", character.playerName);
    if (character.locationHome) addStat("Home", character.locationHome);
    if (character.locationLast) addStat("Last seen", character.locationLast);
  }

  const desc = document.getElementById("character-description");
  if (bio) {
    renderEntryBlocks(desc, { ...bio, blocks: bio.blocks || [] }, { editable });
  } else {
    desc.innerHTML = `<p><em>No biography yet.</em></p>`;
  }

  document.getElementById("format-dropdown")?.addEventListener("change", () => {
    applyFormatToBlocks(main);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await initAuth();
  initEditChrome();

  const main = document.querySelector("main");
  const slug = getSlugFromPath();

  if (!slug) {
    showNotFound(main);
    return;
  }

  try {
    const data = await apiGet(`/characters/${encodeURIComponent(slug)}`);
    renderCharacter(main, data);

    onAuthChange(() => {
      if (isEditMode()) return;
      apiGet(`/characters/${encodeURIComponent(slug)}`).then((fresh) => {
        renderCharacter(main, fresh);
      });
    });
  } catch (err) {
    if (err.status === 404) showNotFound(main);
    else {
      main.innerHTML = `<p>Could not load character.</p>`;
      console.error(err);
    }
  }
});
