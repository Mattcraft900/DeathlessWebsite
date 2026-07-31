import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Resvg } from "@resvg/resvg-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, "..", "client", "public", "images");
const svg = readFileSync(join(dir, "icon-of-sorrow.svg"), "utf8");

/** Tighter crop around the mark for small favicons (original art is padded in 800×800). */
const FAVICON_VIEWBOX = "40 120 720 560";

function render(size, { background, crop } = {}) {
    let svgStr = svg;
    if (crop) {
        svgStr = svgStr.replace('viewBox="0 0 800 800"', `viewBox="${FAVICON_VIEWBOX}"`);
    }
    if (background) {
        const [vx, vy, vw, vh] = (crop ? FAVICON_VIEWBOX : "0 0 800 800").split(" ");
        svgStr = svgStr.replace(
            "</title>",
            `</title><rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="${background}"/>`,
        );
    }
    const resvg = new Resvg(svgStr, {
        fitTo: { mode: "width", value: size },
    });
    return resvg.render().asPng();
}

writeFileSync(join(dir, "favicon-32.png"), render(32, { crop: true }));
writeFileSync(join(dir, "icon-of-sorrow-32.png"), render(32, { crop: true }));
writeFileSync(join(dir, "icon-of-sorrow-180.png"), render(180, { background: "#faf4e8" }));
console.log("Wrote favicon-32.png, icon-of-sorrow-32.png, icon-of-sorrow-180.png");
