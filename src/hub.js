import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".twext");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export const NAMESPACE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export const DEFAULT_HUB_URL = "https://twexts.sdisk.us/api/v1";

export class HubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function loadCredentials() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function saveCredentials(credentials) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  chmodSync(CONFIG_FILE, 0o600);
}

export function clearCredentials() {
  rmSync(CONFIG_FILE, { force: true });
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const REQUEST_TIMEOUT_MS = 30_000;

function canonicalHubUrl(url) {
  return typeof url === "string" ? url.replace(/\/+$/, "") : url;
}

function validateHubUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new HubError(`Invalid hub URL: ${url}`);
  }
  if (parsed.protocol === "https:") return canonicalHubUrl(url);
  if (parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname))
    return canonicalHubUrl(url);
  throw new HubError(
    `Refusing to send credentials to ${url}; use an https:// hub or a loopback address.`,
  );
}

export function resolveHubUrl(flag, env = process.env) {
  return validateHubUrl(flag ?? env.TWEXTHUB_URL ?? loadCredentials().hub ?? DEFAULT_HUB_URL);
}

function storedCredentialsFor(hub) {
  const credentials = loadCredentials();
  return typeof credentials.hub === "string" &&
    canonicalHubUrl(credentials.hub) === canonicalHubUrl(hub)
    ? credentials
    : {};
}

export function resolveToken(flag, hub, env = process.env) {
  return flag ?? env.TWEXTHUB_TOKEN ?? storedCredentialsFor(hub).token;
}

export function resolveNamespace(flag, hub, env = process.env) {
  return flag ?? env.TWEXTHUB_NAMESPACE ?? storedCredentialsFor(hub).namespace;
}

async function hubRequest(base, path, { method = "GET", token, body, raw = false } = {}) {
  const url = `${base.replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new HubError(
        `The hub at ${base} did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`,
      );
    }
    throw new HubError(`Could not reach the hub at ${base}: ${err.message}`);
  }
  const text = await response.text();
  let data = null;
  if (text && !raw) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    let errorData = null;
    if (text) {
      try {
        errorData = JSON.parse(text);
      } catch {
        // not a JSON error page either
      }
    }
    const detail =
      errorData?.detail ??
      errorData?.errors?.map((error) => `${error.field}: ${error.message}`).join("; ") ??
      (errorData?.title ? `${errorData.title} (HTTP ${response.status})` : null) ??
      (text && errorData === null
        ? `The hub returned a non-JSON error page (HTTP ${response.status}).`
        : `HTTP ${response.status}`);
    throw new HubError(detail, response.status);
  }
  if (!raw && text && data === null) {
    throw new HubError(`The hub returned an invalid JSON response (HTTP ${response.status}).`);
  }
  return raw ? text : data;
}

export async function login(base, namespace, password) {
  return hubRequest(base, "/auth/login", { method: "POST", body: { namespace, password } });
}

export async function signup(base, namespace, password, displayName) {
  return hubRequest(base, "/auth/signup", {
    method: "POST",
    body: { namespace, password, ...(displayName ? { displayName } : {}) },
  });
}

export async function acceptTerms(base, token) {
  return hubRequest(base, "/terms/accept", { method: "POST", token });
}

export async function publishVersion(base, token, namespace, id, payload) {
  return hubRequest(base, `/@${namespace}/${id}/versions`, {
    method: "POST",
    token,
    body: payload,
  });
}

export async function yankVersion(base, token, namespace, id, version) {
  return hubRequest(base, `/@${namespace}/${id}/versions/${version}`, { method: "DELETE", token });
}

export async function createAutomationToken(base, token, body) {
  return hubRequest(base, "/tokens", { method: "POST", token, body });
}

export async function listAutomationTokens(base, token, query = "") {
  return hubRequest(base, `/tokens${query}`, { token });
}

export async function deleteAutomationToken(base, token, id) {
  return hubRequest(base, `/tokens/${id}`, { method: "DELETE", token });
}

export async function listSessions(base, token, query = "") {
  return hubRequest(base, `/sessions${query}`, { token });
}

export async function deleteSession(base, token, id) {
  return hubRequest(base, `/sessions/${id}`, { method: "DELETE", token });
}

export async function me(base, token) {
  return hubRequest(base, "/auth/me", { token });
}

export async function logout(base, token) {
  return hubRequest(base, "/auth/logout", { method: "POST", token });
}

export async function searchExtensions(base, query, limit) {
  const params = new URLSearchParams({ query });
  if (limit !== undefined) params.set("limit", String(limit));
  return hubRequest(base, `/search?${params}`);
}

export async function extensionInfo(base, namespace, id) {
  return hubRequest(base, `/@${namespace}/${id}`);
}

export async function downloadVersion(base, namespace, id, version) {
  return hubRequest(base, `/@${namespace}/${id}/versions/${version}/download`, { raw: true });
}

export async function hubStats(base) {
  return hubRequest(base, "/stats");
}

export async function listReviewQueue(base, token, query = "?status=pending") {
  return hubRequest(base, `/versions${query}`, { token });
}

export async function reviewVersion(base, token, namespace, id, version, body) {
  return hubRequest(base, `/@${namespace}/${id}/versions/${version}`, {
    method: "PATCH",
    token,
    body,
  });
}

export async function listNotifications(base, token, query = "") {
  return hubRequest(base, `/notifications${query}`, { token });
}

export async function markNotificationsRead(base, token, body) {
  return hubRequest(base, "/notifications/read", { method: "POST", token, body });
}
