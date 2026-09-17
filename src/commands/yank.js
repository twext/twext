import { readProjectConfig } from "../project.js";
import { EXTENSION_ID_PATTERN } from "../validate.js";
import { resolveHubUrl, resolveNamespace, resolveToken, yankVersion } from "../hub.js";

export async function yankCommand(product, version, configPath, { url, token }, log) {
  if (!version) {
    log.error("Usage: twext yank <version>");
    return false;
  }

  const hub = resolveHubUrl(url);
  const namespace = resolveNamespace();
  const authToken = resolveToken(token);
  if (!namespace) {
    log.error("Not logged in. Run twext login first.");
    return false;
  }
  if (!authToken) {
    log.error("No token. Run twext login, or pass --token / set TWEXTHUB_TOKEN.");
    return false;
  }

  let id;
  try {
    id = readProjectConfig(configPath).extension?.id;
  } catch {
    id = undefined;
  }
  if (!id) {
    log.error(`"${configPath}" has no extension.id; run twext yank from the project directory.`);
    return false;
  }
  if (typeof id !== "string" || !EXTENSION_ID_PATTERN.test(id)) {
    log.error(`extension.id "${id}" is invalid; expected 1-64 lower-case letters or digits.`);
    return false;
  }

  try {
    await yankVersion(hub, authToken, namespace, id, version);
  } catch (err) {
    log.error(err.message);
    return false;
  }
  log.success(`Yanked ${id}@${version}`);
  return true;
}
