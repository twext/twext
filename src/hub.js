import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".twext");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export const NAMESPACE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export const DEFAULT_HUB_URL = "https://twexts.sdisk.us/api/v0";

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
}

export function clearCredentials() {
  rmSync(CONFIG_FILE, { force: true });
}

export function resolveHubUrl(flag, env = process.env) {
  return flag ?? env.TWEXTHUB_URL ?? loadCredentials().hub ?? DEFAULT_HUB_URL;
}

export function resolveToken(flag, env = process.env) {
  return flag ?? env.TWEXTHUB_TOKEN ?? loadCredentials().token;
}

export function resolveNamespace(flag, env = process.env) {
  return flag ?? env.TWEXTHUB_NAMESPACE ?? loadCredentials().namespace;
}

async function hubRequest(base, path, { method = "GET", token, body } = {}) {
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
    });
  } catch (err) {
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

export async function publishVersion(base, token, namespace, id, manifest, code) {
  return hubRequest(base, `/@${namespace}/${id}/versions`, {
    method: "POST",
    token,
    body: { manifest, code },
  });
}

export async function yankVersion(base, token, namespace, id, version) {
  return hubRequest(base, `/@${namespace}/${id}/versions/${version}`, { method: "DELETE", token });
}

export async function createAutomationToken(base, token, body) {
  return hubRequest(base, "/tokens", { method: "POST", token, body });
}
