/**
 * Thin `/api` fetch helpers. Always send cookies (`credentials: "include"`)
 * so writer session auth works. Failed responses throw Error with `.status`
 * and `.data` (parsed JSON body) for callers / merge retry (409).
 */

const BASE = "/api";

async function parseJson(res) {
    try {
        return await res.json();
    } catch {
        return {};
    }
}

/**
 * @param {Response} res
 * @returns {Promise<object>}
 */
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

/** @param {string} path path after `/api` */
export function apiGet(path) {
    return fetch(`${BASE}${path}`, { credentials: "include" }).then(handleResponse);
}

/** @param {string} path @param {object} body */
export function apiPost(path, body) {
    return fetch(`${BASE}${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }).then(handleResponse);
}

/** @param {string} path @param {object} body */
export function apiPut(path, body) {
    return fetch(`${BASE}${path}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }).then(handleResponse);
}
