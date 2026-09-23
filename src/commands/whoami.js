import { me, resolveHubUrl, resolveToken } from "../hub.js";

export async function whoamiCommand(product, { url, token, json }, log) {
  const hub = resolveHubUrl(url);
  const authToken = resolveToken(token, hub);
  if (!authToken) {
    log.error("Not logged in. Run twext login first.");
    return false;
  }

  let account;
  try {
    account = await me(hub, authToken);
  } catch (err) {
    log.error(err.message);
    return false;
  }
  if (!account || typeof account.namespace !== "string") {
    log.error("The hub returned an invalid account response.");
    return false;
  }

  if (json) {
    console.log(JSON.stringify(account, null, 2));
    return true;
  }

  console.log(`@${account.namespace}${account.displayName ? ` (${account.displayName})` : ""}`);
  console.log(
    `Role: ${account.role === "admin" ? "admin" : "member"}${account.hasPublished ? " · has published" : ""}`,
  );
  if (account.createdAt) console.log(`Joined: ${account.createdAt.slice(0, 10)}`);
  return true;
}
