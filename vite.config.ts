import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    root: "client",
    publicDir: "public",
    build: {
        outDir: resolve(__dirname, "dist/client"),
        emptyOutDir: true,
        rollupOptions: {
            input: {
                index: resolve(__dirname, "client/index.html"),
                travelogue: resolve(__dirname, "client/travelogue.html"),
                characters: resolve(__dirname, "client/characters.html"),
                character: resolve(__dirname, "client/character.html"),
                settings: resolve(__dirname, "client/settings.html"),
            },
        },
    },
    server: {
        middlewareMode: true,
    },
    appType: "custom",
});
