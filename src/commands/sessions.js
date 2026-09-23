import { deleteSession, listSessions, resolveHubUrl, resolveToken } from "../hub.js";

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

export async function sessionsCommand(product, subcommand, target, { url, token, json }, log) {
  if (subcommand !== "list" && subcommand !== "revoke") {
    log.error(
      subcommand
        ? `Unknown sessions subcommand "${subcommand}"`
        : "Usage: twext sessions list | twext sessions revoke <id>",
    );
    return false;
  }

  const hub = resolveHubUrl(url);
  const authToken = resolveToken(token, hub);
  if (!authToken) {
    log.error("Not logged in. Run twext login first.");
    return false;
  }

  if (subcommand === "list") {
    let page;
    try {
      page = await listSessions(hub, authToken);
    } catch (err) {
      log.error(err.message);
      return false;
    }
    if (json) {
      console.log(JSON.stringify(page, null, 2));
      return true;
    }
    if (page.data.length === 0) {
      console.log("No sessions.");
      return true;
    }
    for (const session of page.data) {
      console.log(
        ` ${session.id.padEnd(4)} created ${formatWhen(session.createdAt)} · last used ${formatWhen(session.lastUsedAt)}`,
      );
    }
    return true;
  }

  if (!target) {
    log.error("Usage: twext sessions revoke <id>");
    return false;
  }
  if (!/^\d+$/.test(target)) {
    log.error("Session id must be a number.");
    return false;
  }

  try {
    await deleteSession(hub, authToken, target);
  } catch (err) {
    log.error(err.message);
    return false;
  }
  if (json) {
    console.log(JSON.stringify({ revoked: target }, null, 2));
    return true;
  }
  log.success(`Revoked session ${target}`);
  return true;
}
