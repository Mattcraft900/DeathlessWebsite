import { apiGet } from "./api.js";
import { smallSrc } from "./character-images.js";

function buildCharacterCard(character) {
  const slug = character.slug;
  return `<a href="/characters/${slug}"><div class="character-card ${character.category}-character-card">
    <img src="${smallSrc(slug)}" alt="Image of ${character.name}" class="character-img" onerror="this.remove()">
    <h3 class="character-name">${character.name}</h3>
    <p class="character-snippet">${character.snippet || ""}</p>
  </div></a>`;
}

document.addEventListener("DOMContentLoaded", async () => {
  const gallery = document.getElementById("party-gallery");
  if (!gallery) return;

  try {
    const { characters } = await apiGet("/characters");
    const party = characters.filter((c) => c.category === "party");
    gallery.innerHTML = party.map(buildCharacterCard).join("");
  } catch (err) {
    gallery.innerHTML = `<p>Could not load characters.</p>`;
    console.error(err);
  }
});
