import { stringify as stringifyYaml } from "yaml";
import { validateProject } from "../validate.js";
import { collectSources } from "../sources.js";
import { warnUnread } from "./notifications.js";
import {
  HubError,
  acceptTerms,
  publishVersion,
  resolveHubUrl,
  resolveNamespace,
  resolveToken,
} from "../hub.js";

// outputPath is the only purely local key: the hub compiles the upload
// itself, so where this machine writes the build means nothing there.
function uploadManifest(config) {
  const doc = { ...config };
  delete doc.outputPath;
  return stringifyYaml(doc);
}

export async function publishCommand(
  product,
  configPath,
  { url, token, namespace: namespaceFlag, visibility },
  log,
) {
  const result = await validateProject(configPath);
  if (!result.ok) {
    for (const message of result.errors) log.error(message);
    return false;
  }
  for (const message of result.warnings) log.warn(message);

  const { config, root } = result.project;
  const id = config.extension.id;
  const version = String(config.version).trim();
  const manifest = uploadManifest(config);
  const sources = collectSources(root, { manifestPath: configPath, outputPath: config.outputPath });
  const fileCount = Object.keys(sources).length;
  if (fileCount === 0) {
    log.error("No source files found to publish.");
    return false;
  }

  const hub = resolveHubUrl(url);
  const namespace = resolveNamespace(namespaceFlag, hub);
  const authToken = resolveToken(token, hub);
  const explicitToken = token ?? process.env.TWEXTHUB_TOKEN;
  if (!namespace) {
    log.error("Not logged in. Run twext login first.");
    return false;
  }
  if (!authToken) {
    log.error("No token. Run twext login, or pass --token / set TWEXTHUB_TOKEN.");
    return false;
  }

await warnUnread(product, { url, token }, log);

  log.progress(
    `Publishing ${id}@${version} (${fileCount} source file${fileCount === 1 ? "" : "s"}) to @${namespace}...`,
  );

  const payload = { manifest, sources, twext: product.version };
  if (visibility) payload.visibility = visibility;
  const publish = () => publishVersion(hub, authToken, namespace, id, payload);
  let published;
  try {
    published = await publish();
  } catch (err) {
    if (!(err instanceof HubError && err.status === 403 && /terms/i.test(err.message))) {
      log.error(err.message);
      return false;
    }
    if (explicitToken) {
      log.error(
        `${err.message} Accept the terms with a session (twext login) before publishing again.`,
      );
      return false;
    }
    log.progress("Accepting the current Terms of Service...");
    try {
      await acceptTerms(hub, authToken);
      published = await publish();
    } catch (acceptErr) {
      log.error(acceptErr.message);
      return false;
    }
  }

  if (!published || typeof published.status !== "string") {
    log.error("The hub returned an invalid publish response.");
    return false;
  }
  if (published.status === "pending") {
    log.success(`${id}@${version} submitted for review (status: pending).`);
    log.info("An admin must approve it before it appears in the registry.");
  } else {
    log.success(`Published ${id}@${version}`);
    if (published.visibility) log.info(`Visibility: ${published.visibility}`);
    if (published.dist?.downloadUrl) log.bullet(published.dist.downloadUrl);
  }
  return true;
}
