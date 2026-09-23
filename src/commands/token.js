import {
  createAutomationToken,
  deleteAutomationToken,
  listAutomationTokens,
  resolveHubUrl,
  resolveToken,
} from "../hub.js";

function formatWhen(iso) {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  if (ms < 60_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function requireSession(hub, token, log) {
  const authToken = resolveToken(token, hub);
  if (!authToken) {
    log.error("Not logged in. Run twext login first.");
    return null;
  }
  return authToken;
}

async function createCommand(
  hub,
  authToken,
  { name, scope, "expires-in-days": expiresInDays },
  log,
) {
  const scopes = (scope ?? [])
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (scopes.length === 0) scopes.push("publish");
  const invalid = scopes.find((entry) => entry !== "publish" && entry !== "yank");
  if (invalid) {
    log.error(`Unknown scope "${invalid}". Use "publish" and/or "yank".`);
    return false;
  }

  let days = undefined;
  if (expiresInDays !== undefined) {
    days = Number(expiresInDays);
    if (!Number.isInteger(days) || days < 1) {
      log.error("--expires-in-days must be a positive integer.");
      return false;
    }
  }

  const body = {
    name: name ?? "CI",
    scopes,
    ...(days === undefined ? {} : { expiresInDays: days }),
  };
  let created;
  try {
    created = await createAutomationToken(hub, authToken, body);
  } catch (err) {
    log.error(err.message);
    return false;
  }
  if (!created || typeof created.token !== "string" || !Array.isArray(created.scopes)) {
    log.error("The hub returned an invalid token response.");
    return false;
  }
  log.success(`Created token "${created.name}" with scope ${created.scopes.join(", ")}`);
  log.info("The token is shown once; keep it out of the repository.");
  log.bullet(created.token);
  return true;
}

async function listCommand(hub, authToken, { json }, log) {
  let page;
  try {
    page = await listAutomationTokens(hub, authToken);
  } catch (err) {
    log.error(err.message);
    return false;
  }
  if (json) {
    console.log(JSON.stringify(page, null, 2));
    return true;
  }
  if (page.data.length === 0) {
    console.log("No automation tokens.");
    return true;
  }
  for (const row of page.data) {
    console.log(
      ` ${row.id.padEnd(4)} ${row.name.padEnd(16)} scopes ${row.scopes.join(",")} · created ${formatWhen(row.createdAt)} · last used ${formatWhen(row.lastUsedAt)}`,
    );
  }
  return true;
}

async function revokeCommand(hub, authToken, target, { json }, log) {
  if (!target) {
    log.error("Usage: twext token revoke <id>");
    return false;
  }
  if (!/^\d+$/.test(target)) {
    log.error("Token id must be a number.");
    return false;
  }
  try {
    await deleteAutomationToken(hub, authToken, target);
  } catch (err) {
    log.error(err.message);
    return false;
  }
  if (json) {
    console.log(JSON.stringify({ revoked: target }, null, 2));
    return true;
  }
  log.success(`Revoked token ${target}`);
  return true;
}

export async function tokenCommand(product, subcommand, target, values, log) {
  if (subcommand !== "create" && subcommand !== "list" && subcommand !== "revoke") {
    log.error(
      subcommand
        ? `Unknown token subcommand "${subcommand}"`
        : "Usage: twext token <create|list|revoke> [id]",
    );
    return false;
  }

  const hub = resolveHubUrl(values.url);
  const authToken = await requireSession(hub, values.token, log);
  if (!authToken) return false;

  if (subcommand === "create") return createCommand(hub, authToken, values, log);
  if (subcommand === "list") return listCommand(hub, authToken, values, log);
  return revokeCommand(hub, authToken, target, values, log);
}
