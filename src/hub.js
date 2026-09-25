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

async function hubRequest(base, path, { method = "GET", token, body, raw, contentType } = {}) {
  const url = `${base.replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(body === undefined && raw === undefined
          ? {}
          : { "content-type": contentType ?? "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
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
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail =
      data?.detail ??
      data?.errors?.map((error) => `${error.field}: ${error.message}`).join("; ") ??
      (data?.title ? `${data.title} (HTTP ${response.status})` : `HTTP ${response.status}`);
    throw new HubError(detail, response.status);
  }
  return data;
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

// Publishes a gzipped tarball of the project directory. The hub extracts
// twext.yml, validates it, and compiles the extension itself; the manifest is
// derived from the uploaded project, not sent separately.
export async function publishTarball(base, token, namespace, id, tarball) {
  return hubRequest(base, `/@${namespace}/${id}/versions`, {
    method: "POST",
    token,
    raw: tarball,
    contentType: "application/gzip",
  });
}

export async function yankVersion(base, token, namespace, id, version) {
  return hubRequest(base, `/@${namespace}/${id}/versions/${version}`, { method: "DELETE", token });
}

export async function createAutomationToken(base, token, body) {
  return hubRequest(base, "/tokens", { method: "POST", token, body });
}
