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

function renderGallery(container, characters) {
  container.innerHTML = characters.map(buildCharacterCard).join("");
}

document.addEventListener("DOMContentLoaded", async () => {
  const partyGallery = document.getElementById("party-gallery");
  const opcGallery = document.getElementById("opc-gallery");

  try {
    const { characters } = await apiGet("/characters");
    const party = characters.filter((c) => c.category === "party");
    const opc = characters.filter((c) => c.category === "opc");

    if (partyGallery) renderGallery(partyGallery, party);
    if (opcGallery) renderGallery(opcGallery, opc);
  } catch (err) {
    console.error(err);
    if (partyGallery) partyGallery.innerHTML = `<p>Could not load characters.</p>`;
  }
});
