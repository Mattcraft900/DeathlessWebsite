const BASE = "/api";

async function parseJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function handleResponse(res) {
  const data = await parseJson(res);
  if (!res.ok) {
    const err = new Error(data.error || res.statusText || "Request failed");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function apiGet(path) {
  return fetch(`${BASE}${path}`, { credentials: "include" }).then(handleResponse);
}

export function apiPost(path, body) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(handleResponse);
}

export function apiPut(path, body) {
  return fetch(`${BASE}${path}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(handleResponse);
}
