/**
 * Writer session UI: cookie restore, login/logout, account + discard modals.
 *
 * `currentWriter` is the in-memory session mirror of `/api/auth/me`. Pages call
 * `initAuth()` once on load; `onAuthChange` lets galleries / travelogue refresh
 * when login state changes. Modal promises settle once (cancel vs submit) so
 * callers don't double-resolve.
 */

import { apiGet, apiPost } from "./api.js";

/* ---------------------------------------------------------- */
/* -- Session state                                        -- */
/* ---------------------------------------------------------- */

let currentWriter = null;
const listeners = new Set();

/** @returns {object|null} logged-in writer or null */
export function getCurrentWriter() {
    return currentWriter;
}

/**
 * Subscribe to auth changes (login / logout / cookie restore).
 * @param {(writer: object|null) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onAuthChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function notifyAuthChange() {
    for (const fn of listeners) fn(currentWriter);
    document.body.classList.toggle("logged-in", Boolean(currentWriter));
}

/* ---------------------------------------------------------- */
/* -- Generic modal helper                                 -- */
/* ---------------------------------------------------------- */

function closeModal() {
    const backdrop = document.querySelector(".auth-modal-backdrop");
    if (backdrop) backdrop.remove();
}

/**
 * Build a simple form modal. `onSubmit` may throw to keep the modal open and
 * show `errorEl`. Backdrop click / Cancel call `onCancel`.
 */
function showModal(title, fields, onSubmit, { onCancel } = {}) {
    closeModal();
    const backdrop = document.createElement("div");
    backdrop.className = "auth-modal-backdrop";
    backdrop.innerHTML = `
        <div class="auth-modal" role="dialog" aria-modal="true">
            <h3>${title}</h3>
            <form class="auth-form"></form>
        </div>
    `;
    const form = backdrop.querySelector(".auth-form");
    const errorEl = document.createElement("p");
    errorEl.className = "auth-error hidden";

    for (const field of fields) {
        const label = document.createElement("label");
        label.textContent = field.label;
        label.htmlFor = field.id;
        form.appendChild(label);

        let input;
        if (field.type === "select") {
            input = document.createElement("select");
            input.id = field.id;
            input.name = field.name;
            for (const opt of field.options) {
                const o = document.createElement("option");
                o.value = opt.value;
                o.textContent = opt.label;
                input.appendChild(o);
            }
        } else {
            input = document.createElement("input");
            input.type = field.type || "text";
            input.id = field.id;
            input.name = field.name;
            if (field.autocomplete) input.autocomplete = field.autocomplete;
        }
        form.appendChild(input);
    }

    form.appendChild(errorEl);

    const actions = document.createElement("div");
    actions.className = "auth-modal-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "auth-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
        closeModal();
        onCancel?.();
    });
    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.className = "auth-btn";
    submitBtn.textContent = "Submit";
    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    form.appendChild(actions);

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        errorEl.classList.add("hidden");
        const fd = new FormData(form);
        const values = Object.fromEntries(fd.entries());
        try {
            await onSubmit(values, errorEl);
            closeModal();
        } catch (err) {
            errorEl.textContent = err.data?.error || err.message || "Something went wrong";
            errorEl.classList.remove("hidden");
        }
    });

    backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) {
            closeModal();
            onCancel?.();
        }
    });

    document.body.appendChild(backdrop);
    form.querySelector("input, select")?.focus();
}

/* ---------------------------------------------------------- */
/* -- Login / logout                                       -- */
/* ---------------------------------------------------------- */

/**
 * Opens the writer + PIN login modal.
 * @returns {Promise<object|null>} writer on success, null if cancelled
 */
export function promptLogin() {
    return new Promise(async (resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };

        let writers;
        try {
            ({ writers } = await apiGet("/auth/writers"));
        } catch (err) {
            alert(err.data?.error || err.message || "Could not load writers");
            finish(null);
            return;
        }

        showModal(
            "Writing as…",
            [
                {
                    label: "Writer",
                    id: "auth-writer",
                    name: "slug",
                    type: "select",
                    options: writers.map((w) => ({ value: w.slug, label: w.displayName })),
                },
                {
                    label: "PIN",
                    id: "auth-pin",
                    name: "pin",
                    type: "password",
                    autocomplete: "current-password",
                },
            ],
            async (values, errorEl) => {
                try {
                    const data = await apiPost("/auth/login", {
                        slug: values.slug,
                        pin: values.pin,
                    });
                    currentWriter = data.writer;
                    notifyAuthChange();
                    finish(currentWriter);
                } catch (err) {
                    errorEl.textContent = err.data?.error || "Login failed";
                    errorEl.classList.remove("hidden");
                    throw err;
                }
            },
            { onCancel: () => finish(null) },
        );
    });
}

/** Clears the writer session cookie and local state. */
export async function logoutWriter() {
    try {
        await apiPost("/auth/logout", {});
    } catch {
        // Still clear local state if the request fails
    }
    currentWriter = null;
    notifyAuthChange();
}

/* ---------------------------------------------------------- */
/* -- Account & discard confirm                            -- */
/* ---------------------------------------------------------- */

/**
 * Account sheet opened via long-press on the Edit FAB.
 * @returns {Promise<"logout"|"change"|"cancel">}
 */
export function showAccountModal() {
    return new Promise((resolve) => {
        closeModal();
        const writer = currentWriter;
        const statusText = writer
            ? `Signed in as ${writer.displayName}`
            : "Not logged in";

        const backdrop = document.createElement("div");
        backdrop.className = "auth-modal-backdrop";
        backdrop.innerHTML = `
            <div class="auth-modal auth-account-modal" role="dialog" aria-modal="true">
                <h3>Writer</h3>
                <p class="auth-confirm-message">${statusText}</p>
                <div class="auth-modal-actions auth-account-actions">
                    <button type="button" class="auth-btn auth-btn-logout" ${writer ? "" : "disabled"}>Log Out</button>
                    <button type="button" class="auth-btn auth-btn-change-writer">Change Writer</button>
                    <button type="button" class="auth-btn auth-btn-ghost">Cancel</button>
                </div>
            </div>
        `;

        const finish = (action) => {
            closeModal();
            resolve(action);
        };

        backdrop.querySelector(".auth-btn-logout").addEventListener("click", () => {
            if (!writer) return;
            finish("logout");
        });
        backdrop.querySelector(".auth-btn-change-writer").addEventListener("click", () => {
            finish("change");
        });
        backdrop.querySelector(".auth-btn-ghost").addEventListener("click", () => {
            finish("cancel");
        });
        backdrop.addEventListener("click", (e) => {
            if (e.target === backdrop) finish("cancel");
        });

        document.body.appendChild(backdrop);
        backdrop.querySelector(".auth-btn-change-writer")?.focus();
    });
}

/**
 * Confirm dialog with equal-width actions.
 * Destructive action is the filled "Cancel" (discard); "Keep Editing" is backgroundless.
 * Wording matches the footer Cancel button so writers aren't surprised.
 *
 * @returns {Promise<boolean>} true if user chose to discard (Cancel), false to keep editing
 */
export function showDiscardConfirmModal() {
    return new Promise((resolve) => {
        closeModal();
        const backdrop = document.createElement("div");
        backdrop.className = "auth-modal-backdrop";
        backdrop.innerHTML = `
            <div class="auth-modal auth-confirm-modal" role="dialog" aria-modal="true">
                <h3>Discard changes?</h3>
                <p class="auth-confirm-message">
                    All unsaved changes will be lost.
                </p>
                <div class="auth-modal-actions auth-confirm-actions">
                    <button type="button" class="auth-btn auth-btn-confirm-discard">Cancel</button>
                    <button type="button" class="auth-btn auth-btn-ghost">Keep Editing</button>
                </div>
            </div>
        `;

        const finish = (discard) => {
            closeModal();
            resolve(discard);
        };

        backdrop.querySelector(".auth-btn-confirm-discard").addEventListener("click", () => {
            finish(true);
        });
        backdrop.querySelector(".auth-btn-ghost").addEventListener("click", () => {
            finish(false);
        });
        backdrop.addEventListener("click", (e) => {
            if (e.target === backdrop) finish(false);
        });

        document.body.appendChild(backdrop);
        backdrop.querySelector(".auth-btn-ghost")?.focus();
    });
}

/* ---------------------------------------------------------- */
/* -- Cookie session restore                               -- */
/* ---------------------------------------------------------- */

let authReady = null;

/**
 * Restores the cookie session once per page load. Safe to call multiple times
 * (returns the same promise).
 * @returns {Promise<object|null>}
 */
export function initAuth() {
    if (!authReady) {
        authReady = (async () => {
            try {
                const data = await apiGet("/auth/me");
                currentWriter = data.writer;
            } catch {
                currentWriter = null;
            }
            notifyAuthChange();
            return currentWriter;
        })();
    }
    return authReady;
}
