import { apiGet } from "./api.js";

function buildCharacterCard(character) {
  const slug = character.slug;
  const hasImage = Boolean(character.imagePath);
  let inner = `<a href="/characters/${slug}"><div class="character-card ${character.category}-character-card">`;

  if (hasImage) {
    inner += `<img src="${character.imagePath}" alt="Image of ${character.name}" class="character-img">`;
  }

  inner += `
    <h3 class="character-name">${character.name}</h3>
    <p class="character-snippet">${character.snippet || ""}</p>
  </div></a>`;

  return inner;
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
