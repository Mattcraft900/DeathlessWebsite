/**
 * Load Google Fonts family names on demand (one <link> per family).
 */

const loaded = new Set();

/**
 * @param {string|null|undefined} family Google Fonts family name, e.g. "Indie Flower"
 */
export function ensureGoogleFont(family) {
    if (!family || typeof family !== "string") return;
    const name = family.trim();
    if (!name || loaded.has(name)) return;
    loaded.add(name);

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}&display=swap`;
    document.head.appendChild(link);
}

/**
 * Apply per-writer handwriting CSS vars on an element (and load the font).
 * @param {HTMLElement} el
 * @param {string|null|undefined} color hex e.g. "#6a2218"
 * @param {string|null|undefined} font family name
 */
export function applyHandwritingStyle(el, color, font) {
    if (color) {
        el.style.setProperty("--writer-color", color);
    } else {
        el.style.removeProperty("--writer-color");
    }

    if (font) {
        ensureGoogleFont(font);
        el.style.setProperty("--writer-font", `"${font}", Helvetica, sans-serif`);
    } else {
        el.style.removeProperty("--writer-font");
    }
}
