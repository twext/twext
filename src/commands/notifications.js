import { readProjectConfig } from "../project.js";
import { EXTENSION_ID_PATTERN } from "../validate.js";
import {
  listNotifications,
  markNotificationsRead,
  resolveHubUrl,
  resolveNamespace,
  resolveToken,
} from "../hub.js";
import pc from "picocolors";

const KIND_GLYPHS = {
  "review.approved": "✓",
  "review.rejected": "✗",
};

const KIND_LABELS = {
  "review.approved": "approved",
  "review.rejected": "rejected",
  "terms.bumped": "terms",
  "tokens.revoked": "account",
  "role.changed": "account",
  broadcast: "notice",
};

const DEFAULT_LIMIT = 20;
const POLL_INTERVAL_MS = 30_000;
const DEFAULT_WAIT_TIMEOUT_S = 900;
const WAIT_PAGE_LIMIT = 50;

function relativeAge(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function kindLabel(kind) {
  return KIND_LABELS[kind] ?? kind;
}

function matchesDecision(note, namespace, id, version) {
  if (note.kind !== "review.approved" && note.kind !== "review.rejected") return false;
  return (
    note.payload?.namespace === namespace &&
    note.payload?.id === id &&
    note.payload?.version === version
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireCredentials({ url, token }, log) {
  const hub = resolveHubUrl(url);
  const namespace = resolveNamespace(undefined, hub);
  const authToken = resolveToken(token, hub);
  if (!authToken) {
    log.error("No token. Run twext login, or pass --token / set TWEXTHUB_TOKEN.");
    return null;
  }
  return { hub, namespace, authToken };
}

function localTarget(configPath, namespace, log) {
  let config;
  try {
    config = readProjectConfig(configPath);
  } catch {
    config = undefined;
  }
  const id = config?.extension?.id;
  if (typeof id !== "string" || !EXTENSION_ID_PATTERN.test(id)) {
    log.error(`"${configPath}" has no extension.id; --wait needs it to match decisions.`);
    return null;
  }
  return { namespace, id, version: String(config.version ?? "0.0.0") };
}

function parseWaitTimeout(raw) {
  if (raw === undefined) return DEFAULT_WAIT_TIMEOUT_S;
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds < 1) return null;
  return seconds;
}

export async function notificationsCommand(
  product,
  configPath,
  { url, token, all, json, read, wait, "wait-timeout": waitTimeout },
  log,
) {
  const credentials = requireCredentials({ url, token }, log);
  if (!credentials) return false;

  if (!wait) {
    const query = new URLSearchParams();
    if (!all) query.set("unread", "true");
    query.set("limit", String(DEFAULT_LIMIT));
    let list;
    try {
      list = await listNotifications(credentials.hub, credentials.authToken, `?${query}`);
    } catch (err) {
      log.error(err.message);
      return 1;
    }

    if (json) {
      console.log(JSON.stringify(list, null, 2));
      return 0;
    }

    for (const note of list.data) {
      const glyph = KIND_GLYPHS[note.kind] ?? product.symbols.bullet;
      const flag = note.read ? " " : "*";
      console.log(
        ` ${flag}${glyph} ${kindLabel(note.kind).padEnd(9)} ${relativeAge(note.createdAt).padEnd(9)} ${note.message}`,
      );
    }
    if (list.data.length === 0) {
      console.log(
        all ? "No notifications." : "No unread notifications. Use --all to see everything.",
      );
    }
    if (list.unreadCount > 0) {
      log.info(
        pc.dim(`${list.unreadCount} unread. Run \`twext notifications --read\` to mark them read.`),
      );
    }

    if (read && list.data.length > 0) {
      try {
        const marked = await markNotificationsRead(credentials.hub, credentials.authToken, {
          ids: list.data.map((n) => Number(n.id)),
        });
        log.success(
          `Marked ${marked.updated} notification${marked.updated === 1 ? "" : "s"} read.`,
        );
      } catch (err) {
        log.error(err.message);
        return 1;
      }
    }
    return 0;
  }

  const target = localTarget(configPath, credentials.namespace, log);
  if (!target) return false;
  const timeoutS = parseWaitTimeout(waitTimeout);
  if (timeoutS === null) {
    log.error("--wait-timeout must be a positive integer (seconds).");
    return false;
  }

  log.progress(
    `Waiting for a review decision on ${target.id}@${target.version} (polls every ${POLL_INTERVAL_MS / 1000}s, timeout ${timeoutS}s)...`,
  );

  const deadline = Date.now() + timeoutS * 1000;
  for (;;) {
    let list;
    try {
      list = await listNotifications(
        credentials.hub,
        credentials.authToken,
        `?unread=true&limit=${WAIT_PAGE_LIMIT}`,
      );
    } catch (err) {
      log.error(err.message);
      return 1;
    }
    const hit = list.data.find((note) =>
      matchesDecision(note, target.namespace, target.id, target.version),
    );
    if (hit) {
      await markNotificationsRead(credentials.hub, credentials.authToken, {
        ids: [Number(hit.id)],
      }).catch(() => {});
      console.log(`${KIND_GLYPHS[hit.kind] ?? product.symbols.bullet} ${hit.message}`);
      return hit.kind === "review.approved" ? 0 : 1;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      log.warn(`No decision yet; giving up after ${timeoutS}s. Try again later.`);
      return 2;
    }
    await sleep(Math.min(POLL_INTERVAL_MS, remaining));
  }
}

// One-line unread notice shown by publish/yank. Never fails the command, and
// stays quiet for explicit CI tokens so automation logs don't pick it up.
export async function warnUnread(product, { url, token }, log) {
  try {
    if (token !== undefined || process.env.TWEXTHUB_TOKEN !== undefined) return;
    const hub = resolveHubUrl(url);
    const authToken = resolveToken(undefined, hub);
    if (!authToken) return;
    const list = await listNotifications(hub, authToken, "?unread=true&limit=1");
    if (list.unreadCount > 0) {
      log.warn(
        `${list.unreadCount} unread notification${list.unreadCount === 1 ? "" : "s"} — run \`twext notifications\``,
      );
    }
  } catch {
    // the banner must never break a publish or yank
  }
}
