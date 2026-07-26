import { apiGet, apiPost } from "./api.js";

let currentWriter = null;
const listeners = new Set();

export function getCurrentWriter() {
  return currentWriter;
}

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyAuthChange() {
  for (const fn of listeners) fn(currentWriter);
  document.body.classList.toggle("logged-in", Boolean(currentWriter));
}

function closeModal() {
  const backdrop = document.querySelector(".auth-modal-backdrop");
  if (backdrop) backdrop.remove();
}

function showModal(title, fields, onSubmit) {
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
  cancelBtn.addEventListener("click", closeModal);
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
    if (e.target === backdrop) closeModal();
  });

  document.body.appendChild(backdrop);
  form.querySelector("input, select")?.focus();
}

function showLoginModal(writers) {
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
        renderAuthControl(document.getElementById("auth-control"));
      } catch (err) {
        errorEl.textContent = err.data?.error || "Login failed";
        errorEl.classList.remove("hidden");
        throw err;
      }
    },
  );
}

function showChangePinModal() {
  showModal(
    "Change PIN",
    [
      {
        label: "Current PIN",
        id: "current-pin",
        name: "currentPin",
        type: "password",
        autocomplete: "current-password",
      },
      {
        label: "New PIN (min 4 characters)",
        id: "new-pin",
        name: "newPin",
        type: "password",
        autocomplete: "new-password",
      },
    ],
    async (values) => {
      await apiPost("/auth/change-pin", {
        currentPin: values.currentPin,
        newPin: values.newPin,
      });
    },
  );
}

export async function initAuth() {
  try {
    const data = await apiGet("/auth/me");
    currentWriter = data.writer;
  } catch {
    currentWriter = null;
  }
  notifyAuthChange();
}

export function renderAuthControl(container) {
  if (!container) return;
  container.innerHTML = "";

  const label = document.createElement("span");
  label.className = "auth-label";
  label.textContent = "Writing as: ";

  if (currentWriter) {
    const name = document.createElement("span");
    name.className = "auth-writer-name";
    name.textContent = currentWriter.displayName;

    const logoutBtn = document.createElement("button");
    logoutBtn.type = "button";
    logoutBtn.className = "auth-btn";
    logoutBtn.textContent = "Log out";
    logoutBtn.addEventListener("click", async () => {
      await apiPost("/auth/logout", {});
      currentWriter = null;
      notifyAuthChange();
      renderAuthControl(container);
    });

    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.className = "auth-btn edit-only";
    pinBtn.textContent = "Change PIN";
    pinBtn.addEventListener("click", showChangePinModal);

    container.append(label, name, logoutBtn, pinBtn);
  } else {
    const guest = document.createElement("span");
    guest.textContent = "Guest";

    const loginBtn = document.createElement("button");
    loginBtn.type = "button";
    loginBtn.className = "auth-btn";
    loginBtn.textContent = "Log in";
    loginBtn.addEventListener("click", async () => {
      const { writers } = await apiGet("/auth/writers");
      showLoginModal(writers);
    });

    container.append(label, guest, loginBtn);
  }
}
