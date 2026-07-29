/** @param {string} slug */
export function smallSrc(slug) {
  return `/images/characters/${slug}-small.jpg`;
}

/** @param {string} slug */
export function fullSrc(slug) {
  return `/images/characters/${slug}-full.jpg`;
}

/**
 * Detail portrait: prefer full, fall back to small, then hide.
 * @param {HTMLImageElement} img
 * @param {string} slug
 * @param {string} name
 */
export function attachDetailPortrait(img, slug, name) {
  img.alt = `Image of ${name}`;
  img.src = fullSrc(slug);
  img.classList.remove("hidden");

  let triedSmall = false;
  img.addEventListener("error", () => {
    if (!triedSmall) {
      triedSmall = true;
      img.src = smallSrc(slug);
      return;
    }
    img.removeAttribute("src");
    img.classList.add("hidden");
  });
}
