/**
 * Settings page: Change PIN + Handwriting (mobile-first).
 */

import { apiGet, apiPost } from "./api.js";
import {
    getCurrentWriter,
    initAuth,
    logoutWriter,
    promptLogin,
    setCurrentWriter,
} from "./auth-ui.js";
import { applyHandwritingStyle, ensureGoogleFont } from "./fonts.js";

const DEFAULT_COLORS = {
    "voice-lucy": "#6a2218",
    "voice-nemah": "#7a3d62",
    "voice-luark": "#4a4570",
    "voice-enza": "#2a5f72",
    "voice-chesco": "#3d6a42",
    "voice-dm": "#5c4f44",
};

const GOOGLE_FONTS_HELP_URL =
    "https://fonts.google.com/?preview.text=Then%20take%20of%20thyself%20strength%20in%20in%20death,%20borne%20in%20tears%20of%20purest%20silver,%20and%20in%20so%20doing%20curse%20thyself%20to%20existence,%20now%20and%20forever%20deathless.&categoryFilters=Calligraphy:%2FScript%2FHandwritten";

/** Sample travelogue-style run for the handwriting preview (Lucy + party asides). */
const PREVIEW_SNIPPETS = [
    { slug: "lucy", text: "Lucy's text contains all sorts of fun and insightful commentary" },
    { slug: "chesco", text: "just like me! I'm fun and insightful!" },
    { slug: "nemah", text: "you… certainly are, Chesco." },
    { slug: "lucy", text: "about the world around our heroes." },
    { slug: "enza", text: "Wait, whose heroes?" },
    { slug: "lucy", text: "Use this as a pre-view", startsParagraph: true },
    { slug: "luark", text: "It's just spelled preview, no hyphen" },
    { slug: "lucy", text: "of what your handwriting looks like alongside everyone else's." },
];

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

/** @type {object[]} */
let allWriters = [];

/** @type {{ color: string, font: string }} */
let savedHandwriting = { color: "#6a2218", font: "" };

function defaultColorForWriter(writer) {
    if (writer?.handwritingColor && HEX_RE.test(writer.handwritingColor)) {
        return writer.handwritingColor;
    }
    return DEFAULT_COLORS[writer?.cssClass] || "#6a2218";
}

function normalizeHex(value) {
    if (typeof value !== "string") return null;
    let v = value.trim();
    if (!v.startsWith("#")) v = `#${v}`;
    if (/^#[0-9A-Fa-f]{3}$/.test(v)) {
        v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
    }
    return HEX_RE.test(v) ? v.toLowerCase() : null;
}

function showEl(el, text) {
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("hidden", !text);
}

function hideEl(el) {
    if (!el) return;
    el.textContent = "";
    el.classList.add("hidden");
}

/* ---------------------------------------------------------- */
/* -- Auth gate + session chrome                           -- */
/* ---------------------------------------------------------- */

async function ensureLoggedIn() {
    await initAuth();
    let writer = getCurrentWriter();
    if (!writer) {
        writer = await promptLogin();
    }
    if (!writer) {
        window.location.assign("/");
        return null;
    }
    return writer;
}

function renderSessionChrome(writer) {
    const nameEl = document.getElementById("settings-writer-name");
    if (nameEl) nameEl.textContent = writer.displayName;
}

/* ---------------------------------------------------------- */
/* -- Change PIN                                           -- */
/* ---------------------------------------------------------- */

function setupPinForm() {
    const form = document.getElementById("change-pin-form");
    const current = document.getElementById("pin-current");
    const neu = document.getElementById("pin-new");
    const confirm = document.getElementById("pin-confirm");
    const submit = document.getElementById("pin-submit");
    const errorEl = document.getElementById("pin-error");
    const successEl = document.getElementById("pin-success");
    if (!form || !current || !neu || !confirm || !submit) return;

    const blockPaste = (e) => {
        e.preventDefault();
    };
    confirm.addEventListener("paste", blockPaste);
    confirm.addEventListener("drop", blockPaste);

    const syncSubmit = () => {
        const ready =
            current.value.length > 0 &&
            neu.value.length > 0 &&
            confirm.value.length > 0;
        submit.disabled = !ready;
    };

    for (const input of [current, neu, confirm]) {
        input.addEventListener("input", () => {
            hideEl(errorEl);
            hideEl(successEl);
            syncSubmit();
        });
    }
    syncSubmit();

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        hideEl(errorEl);
        hideEl(successEl);

        if (neu.value !== confirm.value) {
            showEl(errorEl, "New PIN and confirmation do not match");
            return;
        }
        if (neu.value.length < 4) {
            showEl(errorEl, "New PIN must be at least 4 characters");
            return;
        }

        submit.disabled = true;
        try {
            await apiPost("/auth/change-pin", {
                currentPin: current.value,
                newPin: neu.value,
            });
            current.value = "";
            neu.value = "";
            confirm.value = "";
            syncSubmit();
            showEl(successEl, "PIN updated");
        } catch (err) {
            showEl(errorEl, err.data?.error || err.message || "Could not change PIN");
            syncSubmit();
        }
    });
}

/* ---------------------------------------------------------- */
/* -- Handwriting                                          -- */
/* ---------------------------------------------------------- */

function currentFormHandwriting() {
    const colorInput = document.getElementById("handwriting-color");
    const hexInput = document.getElementById("handwriting-hex");
    const fontInput = document.getElementById("handwriting-font");
    const hex = normalizeHex(hexInput?.value) || normalizeHex(colorInput?.value) || savedHandwriting.color;
    return {
        color: hex,
        font: (fontInput?.value || "").trim(),
    };
}

function isHandwritingDirty() {
    const cur = currentFormHandwriting();
    return (
        cur.color.toLowerCase() !== savedHandwriting.color.toLowerCase() ||
        cur.font !== savedHandwriting.font
    );
}

function syncHandwritingButtons() {
    const dirty = isHandwritingDirty();
    const save = document.getElementById("handwriting-save");
    const discard = document.getElementById("handwriting-discard");
    if (save) save.disabled = !dirty;
    if (discard) discard.disabled = !dirty;
}

function setHandwritingFields(color, font) {
    const colorInput = document.getElementById("handwriting-color");
    const hexInput = document.getElementById("handwriting-hex");
    const fontInput = document.getElementById("handwriting-font");
    const normalized = normalizeHex(color) || "#6a2218";
    if (colorInput) colorInput.value = normalized;
    if (hexInput) hexInput.value = normalized;
    if (fontInput) fontInput.value = font || "";
}

function renderHandwritingPreview() {
    const preview = document.getElementById("handwriting-preview");
    const me = getCurrentWriter();
    if (!preview || !me) return;

    const draft = currentFormHandwriting();
    preview.innerHTML = "";

    for (let i = 0; i < PREVIEW_SNIPPETS.length; i++) {
        const snippet = PREVIEW_SNIPPETS[i];
        const writer = allWriters.find((w) => w.slug === snippet.slug);
        if (!writer) continue;

        if (snippet.startsParagraph && preview.childNodes.length > 0) {
            const br = document.createElement("span");
            br.className = "entry-para-break";
            br.setAttribute("aria-hidden", "true");
            preview.appendChild(br);
        } else if (preview.querySelector(".entry-block")) {
            preview.appendChild(document.createTextNode(" "));
        }

        const span = document.createElement("span");
        span.className = `entry-block ${writer.cssClass} stylized`;
        span.textContent = snippet.text;

        if (writer.id === me.id) {
            applyHandwritingStyle(span, draft.color, draft.font || null);
        } else {
            applyHandwritingStyle(
                span,
                writer.handwritingColor,
                writer.handwritingFont,
            );
        }
        preview.appendChild(span);
    }

    if (draft.font) ensureGoogleFont(draft.font);
}

function setupFontHelp() {
    const toggle = document.getElementById("font-help-toggle");
    const panel = document.getElementById("font-help");
    if (!toggle || !panel) return;

    // Keep the curated Google Fonts URL on the anchor (already in HTML).
    const link = panel.querySelector("a");
    if (link && !link.href) link.href = GOOGLE_FONTS_HELP_URL;

    toggle.addEventListener("click", () => {
        const open = panel.classList.toggle("hidden") === false;
        panel.hidden = !open;
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
}

function setupHandwritingForm(writer) {
    const form = document.getElementById("handwriting-form");
    const colorInput = document.getElementById("handwriting-color");
    const hexInput = document.getElementById("handwriting-hex");
    const fontInput = document.getElementById("handwriting-font");
    const discardBtn = document.getElementById("handwriting-discard");
    const errorEl = document.getElementById("handwriting-error");
    const successEl = document.getElementById("handwriting-success");
    if (!form || !colorInput || !hexInput || !fontInput) return;

    savedHandwriting = {
        color: defaultColorForWriter(writer),
        font: writer.handwritingFont || "",
    };
    setHandwritingFields(savedHandwriting.color, savedHandwriting.font);
    syncHandwritingButtons();
    renderHandwritingPreview();
    setupFontHelp();

    const onDraftChange = () => {
        hideEl(errorEl);
        hideEl(successEl);
        const hex = normalizeHex(hexInput.value);
        if (hex) colorInput.value = hex;
        syncHandwritingButtons();
        renderHandwritingPreview();
    };

    colorInput.addEventListener("input", () => {
        hexInput.value = colorInput.value;
        onDraftChange();
    });
    hexInput.addEventListener("input", onDraftChange);
    hexInput.addEventListener("blur", () => {
        const hex = normalizeHex(hexInput.value);
        if (hex) {
            hexInput.value = hex;
            colorInput.value = hex;
        }
        onDraftChange();
    });
    fontInput.addEventListener("input", onDraftChange);

    discardBtn?.addEventListener("click", () => {
        setHandwritingFields(savedHandwriting.color, savedHandwriting.font);
        hideEl(errorEl);
        hideEl(successEl);
        syncHandwritingButtons();
        renderHandwritingPreview();
    });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        hideEl(errorEl);
        hideEl(successEl);

        const draft = currentFormHandwriting();
        const hex = normalizeHex(draft.color);
        if (!hex) {
            showEl(errorEl, "Enter a valid hex color like #6a2218");
            return;
        }

        const save = document.getElementById("handwriting-save");
        if (save) save.disabled = true;

        try {
            const data = await apiPost("/auth/handwriting", {
                color: hex,
                font: draft.font,
            });
            setCurrentWriter(data.writer);
            const me = allWriters.findIndex((w) => w.id === data.writer.id);
            if (me >= 0) allWriters[me] = { ...allWriters[me], ...data.writer };

            savedHandwriting = {
                color: data.writer.handwritingColor || hex,
                font: data.writer.handwritingFont || "",
            };
            setHandwritingFields(savedHandwriting.color, savedHandwriting.font);
            syncHandwritingButtons();
            renderHandwritingPreview();
            showEl(successEl, "Handwriting saved");
        } catch (err) {
            showEl(
                errorEl,
                err.data?.error || err.message || "Could not save handwriting",
            );
            syncHandwritingButtons();
        }
    });
}

/* ---------------------------------------------------------- */
/* -- Boot                                                 -- */
/* ---------------------------------------------------------- */

async function main() {
    const writer = await ensureLoggedIn();
    if (!writer) return;

    renderSessionChrome(writer);

    document.getElementById("settings-logout")?.addEventListener("click", async () => {
        await logoutWriter();
        window.location.assign("/");
    });

    setupPinForm();

    try {
        const data = await apiGet("/auth/writers");
        allWriters = data.writers || [];
    } catch {
        allWriters = [writer];
    }

    setupHandwritingForm(writer);
}

void main();
