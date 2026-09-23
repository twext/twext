import { hubStats, resolveHubUrl } from "../hub.js";

export async function statsCommand(product, { url, json }, log) {
  const hub = resolveHubUrl(url);
  let stats;
  try {
    stats = await hubStats(hub);
  } catch (err) {
    log.error(err.message);
    return false;
  }
  if (!stats || typeof stats.published !== "number") {
    log.error("The hub returned an invalid stats response.");
    return false;
  }

  if (json) {
    console.log(JSON.stringify(stats, null, 2));
    return true;
  }
  console.log(
    `${stats.published} published extension${stats.published === 1 ? "" : "s"} · ${stats.authors} author${stats.authors === 1 ? "" : "s"} · ${stats.pending} pending review`,
  );
  return true;
}
