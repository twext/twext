import pc from "picocolors";
import { extensionInfo, resolveHubUrl } from "../hub.js";
import { parseRegistryAddress } from "./address.js";

export async function infoCommand(product, rawAddress, { url, json }, log) {
  const address = parseRegistryAddress(rawAddress, log);
  if (!address) return false;

  const hub = resolveHubUrl(url);
  let detail;
  try {
    detail = await extensionInfo(hub, address.namespace, address.id);
  } catch (err) {
    log.error(err.message);
    return false;
  }
  if (!detail || typeof detail.version !== "string") {
    log.error("The hub returned an invalid extension response.");
    return false;
  }

  if (json) {
    console.log(JSON.stringify(detail, null, 2));
    return true;
  }

  console.log(`@${detail.namespace}/${detail.id}  ${pc.bold(detail.name)}`);
  if (detail.description) console.log(detail.description);
  const bits = [`version ${detail.version}`];
  if (detail.license) bits.push(detail.license);
  if (detail.author) bits.push(detail.author);
  if (detail.visibility && detail.visibility !== "public") bits.push(detail.visibility);
  console.log(pc.dim(bits.join(" · ")));
  if (Array.isArray(detail.versions) && detail.versions.length > 0) {
    console.log("Versions:");
    for (const version of detail.versions) {
      const status = version.status === "published" ? "" : ` (${version.status})`;
      console.log(
        `  ${version.version}${status}${version.publishedAt ? ` — ${version.publishedAt.slice(0, 10)}` : ""}`,
      );
    }
  }
  if (detail.readme) {
    console.log(`Readme: ${detail.readme.slice(0, 100).split("\n")[0]}`);
  }
  return true;
}
