import pc from "picocolors";
import { resolveHubUrl, searchExtensions } from "../hub.js";

export async function searchCommand(product, query, { url, limit, json }, log) {
  if (typeof query !== "string" || query.trim() === "") {
    log.error("Usage: twext search <query>");
    return false;
  }

  let maxResults = undefined;
  if (limit !== undefined) {
    maxResults = Number(limit);
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 50) {
      log.error("--limit must be an integer between 1 and 50.");
      return false;
    }
  }

  const hub = resolveHubUrl(url);
  let page;
  try {
    page = await searchExtensions(hub, query.trim(), maxResults);
  } catch (err) {
    log.error(err.message);
    return false;
  }

  if (json) {
    console.log(JSON.stringify(page, null, 2));
    return true;
  }

  if (page.data.length === 0) {
    console.log(`No extensions match "${query.trim()}".`);
    return true;
  }
  for (const item of page.data) {
    console.log(`@${item.namespace}/${item.id}${pc.dim(`@${item.version}`)}  ${item.name}`);
    if (item.description) console.log(pc.dim(`  ${item.description}`));
  }
  if (page.pagination?.hasMore) {
    log.info("More results available; refine the query or raise --limit.");
  }
  return true;
}
