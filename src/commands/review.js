import pc from "picocolors";
import { listReviewQueue, resolveHubUrl, resolveToken, reviewVersion } from "../hub.js";
import { ask } from "../prompt.js";
import { parseRegistryAddress } from "./address.js";

async function listQueue(product, hub, authToken, { json, limit }, log) {
  let maxResults = undefined;
  if (limit !== undefined) {
    maxResults = Number(limit);
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 50) {
      log.error("--limit must be an integer between 1 and 50.");
      return false;
    }
  }
  const query = new URLSearchParams({ status: "pending" });
  if (maxResults !== undefined) query.set("limit", String(maxResults));

  let page;
  try {
    page = await listReviewQueue(hub, authToken, `?${query}`);
  } catch (err) {
    log.error(err.message);
    return false;
  }

  if (json) {
    console.log(JSON.stringify(page, null, 2));
    return true;
  }
  if (page.data.length === 0) {
    console.log("The review queue is empty.");
    return true;
  }
  for (const row of page.data) {
    console.log(
      `@${row.ownerNamespace ?? row.namespace}/${row.id}${pc.dim(`@${row.version}`)}  ${row.name ?? row.id}`,
    );
    if (row.description) console.log(pc.dim(`  ${row.description}`));
    if (row.twextVersion)
      console.log(pc.dim(`  twext ${row.twextVersion} · ${row.createdAt?.slice(0, 10) ?? ""}`));
  }
  return true;
}

async function decide(hub, authToken, subcommand, target, { json, reason }, log) {
  const address = parseRegistryAddress(target, log, { requireVersion: true });
  if (!address) return false;

  const status = subcommand === "approve" ? "approved" : "rejected";
  const body = { status };
  if (status === "rejected") {
    let text = typeof reason === "string" ? reason.trim() : "";
    if (!text) text = (await ask("Rejection reason: ")).trim();
    if (!text) {
      log.error("A reason is required when rejecting.");
      return false;
    }
    body.reason = text;
  }

  let updated;
  try {
    updated = await reviewVersion(
      hub,
      authToken,
      address.namespace,
      address.id,
      address.version,
      body,
    );
  } catch (err) {
    log.error(err.message);
    return false;
  }

  if (json) {
    console.log(JSON.stringify(updated, null, 2));
    return true;
  }
  const verb = status === "approved" ? "Approved" : "Rejected";
  log.success(`${verb} @${address.namespace}/${address.id}@${address.version}`);
  return true;
}

export async function reviewCommand(product, subcommand, target, values, log) {
  if (subcommand !== "list" && subcommand !== "approve" && subcommand !== "reject") {
    log.error(
      subcommand
        ? `Unknown review subcommand "${subcommand}"`
        : "Usage: twext review <list|approve|reject> [@namespace/id@version]",
    );
    return false;
  }

  const hub = resolveHubUrl(values.url);
  const authToken = resolveToken(values.token, hub);
  if (!authToken) {
    log.error("Not logged in. Run twext login first.");
    return false;
  }

  if (subcommand === "list") return listQueue(product, hub, authToken, values, log);
  return decide(hub, authToken, subcommand, target, values, log);
}
