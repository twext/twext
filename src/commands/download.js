import { writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { downloadVersion, extensionInfo, resolveHubUrl } from "../hub.js";
import { parseRegistryAddress } from "./address.js";

async function latestVersion(hub, namespace, id) {
  const detail = await extensionInfo(hub, namespace, id);
  if (!detail || typeof detail.version !== "string") return null;
  return detail.version;
}

export async function downloadCommand(product, rawAddress, { url, out, json }, log) {
  const address = parseRegistryAddress(rawAddress, log);
  if (!address) return false;

  const hub = resolveHubUrl(url);
  let version = address.version;
  try {
    if (!version) version = await latestVersion(hub, address.namespace, address.id);
  } catch (err) {
    log.error(err.message);
    return false;
  }
  if (!version) {
    log.error("The extension has no published version to download.");
    return false;
  }

  let code;
  try {
    code = await downloadVersion(hub, address.namespace, address.id, version);
  } catch (err) {
    log.error(err.message);
    return false;
  }
  if (typeof code !== "string" || code.length === 0) {
    log.error("The hub returned an empty download.");
    return false;
  }

  const file = resolvePath(out ?? `${address.id}@${version}.js`);
  try {
    writeFileSync(file, code);
  } catch (err) {
    log.error(`Could not write ${file}: ${err.message}`);
    return false;
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          namespace: address.namespace,
          id: address.id,
          version,
          file,
          bytes: Buffer.byteLength(code),
        },
        null,
        2,
      ),
    );
    return true;
  }
  log.success(`Saved @${address.namespace}/${address.id}@${version} to ${file}`);
  return true;
}
