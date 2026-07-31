/**
 * Characters index: fetch all characters and split into party / opc / npc galleries.
 * opc = other player character.
 */

import { apiGet } from "./api.js";
import { smallSrc } from "./character-images.js";

/** Helper for building a character card link. */
function buildCharacterCard(character) {
    const slug = character.slug;
    return `<a href="/characters/${slug}"><div class="character-card ${character.category}-character-card">
        <img src="${smallSrc(slug)}" alt="Image of ${character.name}" class="character-img" onerror="this.remove()">
        <h3 class="character-name">${character.name}</h3>
        <p class="character-snippet">${character.snippet || ""}</p>
    </div></a>`;
}

function renderGallery(container, characters) {
    if (!characters.length) {
        const emptyMessage = document.createElement("p");
        emptyMessage.className = "empty-message voice-lucy stylized";
        emptyMessage.textContent = "No characters here yet. :)";
        container.replaceChildren(emptyMessage);
        return;
    }
    container.innerHTML = characters.map(buildCharacterCard).join("");
}

document.addEventListener("DOMContentLoaded", async () => {
    const partyGallery = document.getElementById("party-gallery");
    const opcGallery = document.getElementById("opc-gallery");
    const npcGallery = document.getElementById("npc-gallery");

    try {
        const { characters } = await apiGet("/characters");
        const party = characters.filter((c) => c.category === "party");
        const opc = characters.filter((c) => c.category === "opc");
        const npc = characters.filter((c) => c.category === "npc");

        if (partyGallery) renderGallery(partyGallery, party);
        if (opcGallery) renderGallery(opcGallery, opc);
        if (npcGallery) renderGallery(npcGallery, npc);
    } catch (err) {
        console.error(err);
        if (partyGallery) partyGallery.innerHTML = `<p>Could not load characters.</p>`;
    }
});
